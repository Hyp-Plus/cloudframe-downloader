import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DownloadTask, Platform } from "./download";
import { downloadOrbStates, taskOrbStates, ThinkingOrb } from "./orbs";

type View = "center" | "history" | "files" | "settings";

const platformCopy: Record<Platform, { name: string; hint: string; icon: string }> = {
  bilibili: { name: "哔哩哔哩", hint: "公开投稿、合集与授权内容", icon: "B" },
  douyin: { name: "抖音", hint: "公开分享链接", icon: "D" },
  youtube: { name: "YouTube", hint: "公开视频与 Shorts", icon: "YT" },
  instagram: { name: "Instagram", hint: "公开帖子与 Reels", icon: "IG" },
  xiaohongshu: { name: "小红书", hint: "公开笔记或视频", icon: "XH" },
  twitter: { name: "X / Twitter", hint: "公开帖子中的媒体", icon: "X" },
};

const navItems: Array<{ key: View; label: string; glyph: string }> = [
  { key: "center", label: "传送台", glyph: "↗" },
  { key: "history", label: "任务记录", glyph: "◴" },
  { key: "files", label: "本地收纳", glyph: "□" },
];

function inferPlatform(url: string): Platform | null {
  if (/bilibili\.com|b23\.tv/i.test(url)) return "bilibili";
  if (/douyin\.com|iesdouyin\.com/i.test(url)) return "douyin";
  if (/(?:youtube\.com|youtu\.be)/i.test(url)) return "youtube";
  if (/instagram\.com/i.test(url)) return "instagram";
  if (/(?:xiaohongshu\.com|xhslink\.com)/i.test(url)) return "xiaohongshu";
  if (/(?:twitter\.com|x\.com)/i.test(url)) return "twitter";
  return null;
}

// ── 工业输送线：阶段与读数推断（纯展示层，数据仍以后端 state/detail 为准）──
const stageNames = ["解析", "下载", "转码", "入库"] as const;

function taskStage(task: DownloadTask): number {
  if (task.state === "completed") return 3;
  if (task.state === "cancelled") return -1;
  const detail = task.detail ?? "";
  if (/merg|合并|转码/i.test(detail)) return 2;
  if (/\[download\]\s*[\d.]+%/.test(detail) || task.progress > 2) return 1;
  return 0;
}

function readoutOf(task: DownloadTask) {
  const detail = (task.detail ?? "").trim().replace(/\s+/g, " ");
  const speed = detail.match(/([\d.]+\s*[KMG]iB\/s)/i)?.[1];
  const eta = detail.match(/ETA\s*([\d:]+)/i)?.[1];
  let text = detail;
  if (/\[download\]/i.test(text)) text = speed || eta ? "数据流传输中" : "正在接收媒体数据";
  if (text.length > 64) text = `${text.slice(0, 64)}…`;
  return { speed, eta, text };
}

function stateLabel(task: DownloadTask) {
  if (task.state === "completed") return "已入库";
  if (task.state === "paused") return "已暂停";
  if (task.state === "cancelled") return "已取消";
  if (task.state === "failed") return "故障";
  if (task.state === "queued") return "排队";
  return `${Math.round(task.progress)}%`;
}

// ── 输送线位置模型：舱体横坐标 = f(状态, 真实进度)，货物始终从左向右运输 ──
// staged（上料辊床）→ ST-01 解析 → ST-02 下载（位置随 progress 推进）→ ST-03 转码 → ST-04 出料入库
const LINE = { staging: 64, st1: 229, st2: 376, st2Span: 254, st3: 778, exit: 1142, gap: 144, podW: 120, podY: 90 };
const sensorXs = [370, 760, 920, 1080]; // 工位分界光电传感器 + 出料传感器

function podTargetX(task: DownloadTask, queueIndex: number): number {
  if (task.state === "queued") return LINE.staging - queueIndex * LINE.gap;
  if (task.state === "completed") return LINE.exit;
  const stage = taskStage(task); // paused / failed 冻结在原地：progress 停更 → 坐标停更
  if (stage >= 2) return LINE.st3;
  if (stage === 1) return LINE.st2 + (Math.min(100, Math.max(0, task.progress)) / 100) * LINE.st2Span;
  return LINE.st1;
}

// ── 输送线运动引擎：临界阻尼弹簧驱动舱体坐标，皮带/滚筒随真实速度联动 ──
// 每个舱体独立物理：x/vx 积分 → 目标坐标由 state+progress 决定；
// 皮带速度因子 = max(|vx|)，暂停/故障时 vx→0 全线自然停住；
// 完成态抵达右端后触发倾斜→下落→淡出的出料序列。
type PodMotion = { x: number; vx: number; discharge: number };
function useConveyorMotion(targets: Array<{ task: DownloadTask; x: number }>, reducedMotion: boolean) {
  const podRefs = useRef<Map<string, SVGGElement>>(new Map());
  const conveyorRef = useRef<HTMLElement>(null);
  const sensorRefs = useRef<Array<SVGGElement | null>>([]);
  const binRef = useRef<SVGGElement>(null);
  const motionsRef = useRef<Map<string, PodMotion>>(new Map());
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const binFlashRef = useRef(0);

  useEffect(() => {
    if (reducedMotion) {
      for (const t of targetsRef.current) {
        const el = podRefs.current.get(t.task.id);
        if (el) {
          el.style.transform = `translate(${t.x}px, ${LINE.podY}px)`;
          el.style.opacity = t.task.state === "completed" ? "0" : "1";
        }
      }
      const sensors = sensorXs.map(sx =>
        targetsRef.current.some(p => p.task.state !== "queued" && p.x < sx + 12 && p.x + LINE.podW > sx - 12));
      sensorRefs.current.forEach((el, i) => el?.classList.toggle("on", sensors[i]));
      conveyorRef.current?.style.setProperty("--belt-state", "paused");
      return;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const cur = targetsRef.current;
      let maxV = 0;
      let anyMoving = false;
      const sensors = [false, false, false, false];
      let justDischarged = false;
      for (const t of cur) {
        const id = t.task.id;
        let m = motionsRef.current.get(id);
        if (!m) { m = { x: -210, vx: 0, discharge: 0 }; motionsRef.current.set(id, m); }
        // 临界阻尼弹簧 k=48 c=12.5 → 阻尼比≈0.90，机械式缓启/匀速/缓刹无超调
        const k = 48, c = 12.5;
        const dx = t.x - m.x;
        m.vx += (k * dx - c * m.vx) * dt;
        m.x += m.vx * dt;
        // 完成出料序列：x>1090 后倾斜下落淡出
        if (t.task.state === "completed" && m.x > 1090) {
          const prev = m.discharge;
          m.discharge = Math.min(1, m.discharge + dt / 0.85);
          if (prev < 0.25 && m.discharge >= 0.25) justDischarged = true;
        }
        if (Math.abs(m.vx) > 0.4) anyMoving = true;
        maxV = Math.max(maxV, Math.abs(m.vx));
        for (let i = 0; i < sensorXs.length; i++) {
          if (t.task.state !== "queued" && m.x < sensorXs[i] + 12 && m.x + LINE.podW > sensorXs[i] - 12) sensors[i] = true;
        }
        const el = podRefs.current.get(id);
        if (el) {
          const d = m.discharge;
          el.style.transform = `translate(${m.x + d * 30}px, ${LINE.podY + d * 34}px) rotate(${d * 14}deg)`;
          el.style.opacity = String(Math.max(0, 1 - d));
        }
      }
      for (const id of motionsRef.current.keys()) {
        if (!cur.some(t => t.task.id === id)) motionsRef.current.delete(id);
      }
      const factor = anyMoving ? Math.max(0.35, Math.min(1.8, maxV / 170)) : 0;
      const root = conveyorRef.current;
      if (root) {
        root.style.setProperty("--belt-factor", factor.toFixed(3));
        root.style.setProperty("--belt-state", anyMoving ? "running" : "paused");
        root.style.setProperty("--belt-dur", `${(1.15 / Math.max(factor, 0.35)).toFixed(2)}s`);
        root.style.setProperty("--roller-dur", `${(2.2 / Math.max(factor, 0.35)).toFixed(2)}s`);
        root.style.setProperty("--idler-dur", `${(0.76 / Math.max(factor, 0.35)).toFixed(2)}s`);
      }
      sensorRefs.current.forEach((el, i) => el?.classList.toggle("on", sensors[i]));
      if (justDischarged) binFlashRef.current = 0.7;
      if (binFlashRef.current > 0) {
        binFlashRef.current = Math.max(0, binFlashRef.current - dt);
        binRef.current?.classList.toggle("flash", binFlashRef.current > 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  return { podRefs, conveyorRef, sensorRefs, binRef };
}

function Conveyor({ state, tasks }: { state: "idle" | "queued" | "downloading" | "complete" | "attention"; tasks: DownloadTask[] }) {
  const reducedMotion = useMemo(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  const inFeed = tasks.filter(t => t.state === "queued" || t.state === "downloading");
  const queued = tasks.filter(t => t.state === "queued").slice().reverse();
  const working = tasks.filter(t => t.state === "downloading" || t.state === "paused" || t.state === "failed");
  const exited = tasks.filter(t => t.state === "completed").slice(0, 1);
  // 安全间距：从出料端向左逐个保证 gap，FIFO 队列
  let guard = Number.POSITIVE_INFINITY;
  const allPods = [
    ...[...working, ...exited].map(task => ({ task, ideal: podTargetX(task, 0) })),
    ...queued.map((task, qi) => ({ task, ideal: podTargetX(task, qi) })),
  ].sort((a, b) => b.ideal - a.ideal)
    .map(p => { const x = Math.min(p.ideal, guard - LINE.gap); guard = x; return { task: p.task, x }; });
  const visiblePods = allPods.filter(p => p.x + LINE.podW > -20);
  const waiting = allPods.length - visiblePods.length;
  const active = tasks.find(t => t.state === "downloading");
  const stage = active ? taskStage(active) : state === "complete" ? 3 : state === "queued" ? 0 : -1;
  const copy = {
    idle: "LINE READY · 传送带待命",
    queued: `FEED · 正在准备 ${inFeed.length} 个任务`,
    downloading: `RUN · 正在传送 ${inFeed.length} 个任务`,
    complete: "CYCLE COMPLETE · 文件已收纳到本地",
    attention: "HOLD · 有任务需要处理",
  }[state];
  const title = state === "idle" ? "输送线待命" : state === "complete" ? "文件已经入库" : "媒体输送线运行中";

  const { podRefs, conveyorRef, sensorRefs, binRef } = useConveyorMotion(visiblePods, reducedMotion);
  const railPosts = [250, 480, 710, 940];
  const idlers = [320, 440, 560, 680, 800, 920];
  const zones = [{ x: 198, w: 150 }, { x: 400, w: 330 }, { x: 780, w: 120 }, { x: 940, w: 120 }];

  return <section ref={conveyorRef} className={`conveyor conveyor-${state} stage-${stage}`} aria-label={copy} role="status">
    <div className="conveyor-head">
      <p className="core-label">FLOW LINE · CF-01</p>
      <h3>{title}</h3>
      <p className="core-copy">{state === "idle" ? "粘贴链接后，任务舱自动进给上线" : "解析 · 下载 · 转码 · 入库"}</p>
    </div>
    <div className="conveyor-caption"><span className="signal"></span><span>{copy}</span></div>
    <svg className="conveyor-illustration" viewBox="0 0 1200 330" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="cf-steel" x1="0" y1="0" x2="0" y2="1">
          <stop className="gs-a" offset="0" /><stop className="gs-b" offset="1" />
        </linearGradient>
        <linearGradient id="cf-belt" x1="0" y1="0" x2="0" y2="1">
          <stop className="gb-a" offset="0" /><stop className="gb-b" offset="1" />
        </linearGradient>
        <radialGradient id="cf-roller" cx=".38" cy=".34" r=".9">
          <stop className="gr-a" offset="0" /><stop className="gr-b" offset="1" />
        </radialGradient>
        <linearGradient id="cf-gearbox" x1="0" y1="0" x2="0" y2="1">
          <stop className="gg-a" offset="0" /><stop className="gg-b" offset="1" />
        </linearGradient>
        <pattern id="cf-hazard" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect className="hz-a" width="10" height="10" /><rect className="hz-b" width="5" height="10" />
        </pattern>
        <pattern id="cf-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect className="ht-a" width="7" height="7" /><rect className="ht-b" width="3" height="7" />
        </pattern>
        <pattern id="cf-perf" width="8" height="8" patternUnits="userSpaceOnUse">
          <circle className="pf-dot" cx="2" cy="2" r="1" /><circle className="pf-dot" cx="6" cy="6" r="1" />
        </pattern>
      </defs>
      <path className="m-floor" d="M16 306h1168" />

      {/* ═══ 机架：横梁 / 翼缘 / 支腿 / 斜撑 / 螺栓 / 铭牌 / 张力表 / 警示标 ═══ */}
      <g className="m-frame">
        <rect className="m-leg" x="200" y="244" width="18" height="50" />
        <rect className="m-leg" x="1036" y="244" width="18" height="50" />
        <path className="m-brace" d="M218 250l818 42M218 292l818-42" />
        <g className="m-foot"><rect x="184" y="294" width="50" height="10" rx="1" /></g>
        <g className="m-foot"><rect x="1020" y="294" width="50" height="10" rx="1" /></g>
        <rect className="m-girder" x="196" y="214" width="876" height="30" />
        <rect className="m-flange" x="186" y="208" width="896" height="6" />
        {/* 关键受力螺栓：4 个 */}
        {[310, 560, 820, 1020].map(x => <g className="m-bolt" key={x}><circle cx={x} cy="229" r="2.4" /><circle cx={x} cy="229" r=".9" /></g>)}
        {/* 张力表 */}
        <g className="m-tension">
          <text className="m-gauge-label" x="257" y="206" textAnchor="middle">TENSION</text>
          <rect className="m-plate" x="228" y="220" width="58" height="16" rx="1" />
          <path className="m-ticks" d="M236 224v4M254 224v6M272 224v4M278 224v6" />
          <g className="m-tension-pointer"><path d="M230 233l6-4v8z" /></g>
        </g>
        {/* 资产铭牌 */}
        <g className="m-asset">
          <rect x="462" y="218" width="156" height="22" rx="1" />
          <text className="m-asset-model" x="470" y="227">CF-01 · FLOW LINE</text>
          <text className="m-asset-sn" x="470" y="237">SN:2026-0817 · 24VDC</text>
        </g>
        {/* 警示标 */}
        <text className="m-warn-text" x="927" y="231" textAnchor="middle">⚠ CAUTION</text>
        {/* 工位牌 */}
        {stageNames.map((name, i) => <g className={`m-station station-${i}`} key={name}>
          <rect x={zones[i].x} y="246" width={zones[i].w} height="24" rx="1" />
          <text x={zones[i].x + zones[i].w / 2} y="262" textAnchor="middle">{`ST-0${i + 1} ${name}`}</text>
        </g>)}
      </g>

      {/* ═══ 上料控制台：信标 / 屏幕 / LED / 按键 / 急停 / 选择开关 / 散热槽 ═══ */}
      <g className="m-console">
        <rect className="m-leg" x="36" y="240" width="14" height="54" />
        <rect className="m-foot" x="22" y="294" width="42" height="10" rx="1" />
        <rect className="m-housing" x="14" y="148" width="60" height="96" rx="2" />
        {/* 屏幕 */}
        <rect className="m-screen" x="22" y="156" width="44" height="22" rx="1" />
        <path className="m-screen-line" d="M26 164h28M26 171h36" />
        {/* LED 排 */}
        <circle className="m-led" cx="26" cy="190" r="2.2" />
        <circle className="m-led m-led-run" cx="38" cy="190" r="2.2" />
        <circle className="m-led" cx="50" cy="190" r="2.2" />
        {/* 按键 */}
        <circle className="m-key" cx="26" cy="206" r="3.5" />
        <circle className="m-key m-key-signal" cx="38" cy="206" r="3.5" />
        <circle className="m-key" cx="50" cy="206" r="3.5" />
        {/* 急停按钮 */}
        <circle className="m-estop-base" cx="32" cy="222" r="5" />
        <circle className="m-estop-cap" cx="32" cy="221" r="3.5" />
        {/* 选择开关 */}
        <circle className="m-selector-knob" cx="50" cy="222" r="3" />
        {/* 散热槽 */}
        <path className="m-vents" d="M22 234h44M22 239h44" />
        {/* 信标灯柱 */}
        <rect className="m-mast" x="40" y="64" width="4" height="84" />
        <rect className="m-beacon-housing" x="32" y="38" width="20" height="26" rx="3" />
        <circle className="m-beacon" cx="42" cy="51" r="6.5" />
      </g>

      {/* 上料辊床（无动力区）+ 限位挡块 */}
      <g className="m-apron">
        <rect className="m-apron-bed" x="76" y="146" width="100" height="8" />
        {[100, 132, 154].map(x => <g className="m-idler m-idler-apron" key={x}>
          <circle cx={x} cy="146" r="5" />
        </g>)}
        <rect className="m-hazard" x="76" y="146" width="6" height="8" />
      </g>
      <g className="m-endstop">
        <rect x="56" y="116" width="8" height="24" rx="1" />
        <rect className="m-hazard" x="56" y="116" width="8" height="7" />
      </g>

      {/* ═══ 输送线体 ═══ */}
      <g className="m-line">
        {/* 回程带 */}
        <rect className="m-belt-return" x="204" y="198" width="848" height="8" />
        <path className="m-tread-return" d="M204 202h848" />
        {/* 托辊 */}
        {idlers.map(x => <g className="m-idler" key={x}>
          <circle cx={x} cy="163" r="10" />
          <circle className="m-idler-axle" cx={x} cy="163" r="2" />
        </g>)}
        {/* 尾轮 */}
        <g className="m-roller m-roller-tail">
          <circle cx="210" cy="172" r="32" />
          <path d="M210 148v48M186 172h48" />
          <circle className="m-hub" cx="210" cy="172" r="6" />
        </g>
        {/* 驱动轮 + 联轴器 */}
        <g className="m-roller m-roller-drive">
          <circle cx="1046" cy="172" r="32" />
          <path d="M1046 148v48M1022 172h48" />
          <circle className="m-hub" cx="1046" cy="172" r="6" />
          <rect className="m-coupling" x="1074" y="167" width="10" height="10" rx="1" />
        </g>
        {/* 齿轮箱 */}
        <g className="m-gearbox">
          <rect className="m-gearbox-housing" x="1084" y="158" width="36" height="40" rx="2" />
          <path className="m-gearbox-fin" d="M1088 164h28M1088 172h28M1088 180h28" />
          <circle className="m-sight-glass" cx="1100" cy="190" r="3" />
        </g>
        {/* 电机 */}
        <g className="m-motor">
          <rect x="1026" y="206" width="40" height="24" rx="2" />
          <path d="M1034 212v12M1044 212v12" />
        </g>

        {/* 工作面皮带：高光棱线 + 纹理 */}
        <rect className="m-belt-top" x="176" y="140" width="904" height="12" />
        <path className="m-belt-edge" d="M176 140.5h904" />
        <path className="m-tread-top" d="M176 146h904" />

        {/* 光电传感器 */}
        {sensorXs.map((sx, i) => (
          <g className="m-sensor" key={sx} ref={el => { sensorRefs.current[i] = el; }}>
            <rect className="m-sensor-post" x={sx - 2} y="110" width="4" height="100" />
            <rect className="m-sensor-head" x={sx - 6} y="96" width="12" height="14" rx="2" />
            <circle className="m-sensor-led" cx={sx} cy="103" r="2.2" />
            <path className="m-sensor-beam" d={`M${sx} 110v32`} />
          </g>
        ))}

        {/* 电缆桥架 */}
        <rect className="m-cable-tray" x="200" y="104" width="860" height="4" rx="1" />

        {/* 后导轨 */}
        <g className="m-rail-rear">
          <rect x="182" y="116" width="892" height="4" />
          <rect className="m-rail-slot" x="182" y="116" width="892" height="1.5" />
          {railPosts.map(x => <rect key={x} x={x} y="120" width="5" height="88" />)}
        </g>

        {/* ═══ 任务舱：轮组 / 底盘 / 卡扣 / 防撞条 / 螺栓 / 铭牌 / 数显窗 / 进度槽 / 顶标灯 / RFID ═══ */}
        {visiblePods.map((p, i) => {
          const t = p.task;
          const pct = Math.min(100, Math.max(0, t.progress));
          const unitNo = String(visiblePods.length - i).padStart(2, "0");
          return <g className={`pod-g pod-${t.state}`} key={t.id}
            ref={el => {
              if (el) {
                podRefs.current.set(t.id, el);
                if (!reducedMotion) el.style.transform = "translate(-210px, 90px)";
              }
            }}>
            {/* 接触阴影 */}
            <ellipse className="pod-shadow" cx="60" cy="55" rx="52" ry="3.5" />
            {/* 轮组：前后轴各双轮，接触皮带 */}
            <g className="pod-wheels">
              <line className="pod-axle" x1="18" y1="50" x2="38" y2="50" />
              <circle className="pod-wheel" cx="18" cy="50" r="3.5" /><circle className="pod-wheel-hub" cx="18" cy="50" r="1.2" />
              <circle className="pod-wheel" cx="38" cy="50" r="3.5" /><circle className="pod-wheel-hub" cx="38" cy="50" r="1.2" />
              <line className="pod-axle" x1="82" y1="50" x2="102" y2="50" />
              <circle className="pod-wheel" cx="82" cy="50" r="3.5" /><circle className="pod-wheel-hub" cx="82" cy="50" r="1.2" />
              <circle className="pod-wheel" cx="102" cy="50" r="3.5" /><circle className="pod-wheel-hub" cx="102" cy="50" r="1.2" />
            </g>
            {/* 底盘裙板 */}
            <rect className="pod-skirt" x="2" y="42" width="116" height="7" rx="1" />
            {/* 主舱体 */}
            <rect className="pod-chassis" x="0" y="6" width="120" height="38" rx="2" />
            <rect className="pod-deck" x="0" y="6" width="120" height="7" />
            {/* 卡扣 */}
            <rect className="pod-clasp" x="26" y="3" width="10" height="4" rx="1" />
            <rect className="pod-clasp" x="84" y="3" width="10" height="4" rx="1" />
            {/* 防撞条 */}
            <rect className="pod-bumper" x="0" y="16" width="3" height="22" />
            <rect className="pod-bumper" x="117" y="16" width="3" height="22" />
            {/* 沉孔螺栓（四角） */}
            {[[7, 13], [113, 13], [7, 39], [113, 39]].map(([cx, cy]) =>
              <g className="pod-bolt" key={`${cx}-${cy}`}><circle cx={cx} cy={cy} r="2" /><circle cx={cx} cy={cy} r=".8" /></g>)}
            {/* 平台铭牌 */}
            <rect className="pod-plate" x="8" y="14" width="26" height="22" rx="1" />
            <text className="pod-code" x="21" y="29" textAnchor="middle">{platformCopy[t.platform].icon}</text>
            {/* 编号 */}
            <text className="pod-idx" x="40" y="21">{`UNIT-${unitNo}`}</text>
            {/* 数显窗：深色 OLED 风格，琥珀色读数 */}
            <rect className="pod-display" x="40" y="25" width="44" height="12" rx="1" />
            {pct > 0
              ? <text className="pod-display-text" x="62" y="34" textAnchor="middle">{`${Math.round(pct)}%`}</text>
              : <text className="pod-display-text pod-display-idle" x="62" y="34" textAnchor="middle">----</text>}
            {/* 进度槽（舱体右侧） */}
            <rect className="pod-slot" x="88" y="25" width="24" height="12" rx="1" />
            {pct > 0 && <rect className="pod-fill" x="89.5" y="26.5" width={Math.max(1.5, 21 * pct / 100)} height="9" />}
            {/* 顶标状态灯 */}
            <rect className="pod-beacon-post" x="58" y="0" width="4" height="6" />
            <rect className="pod-lamp" x="55" y="-5" width="10" height="7" rx="2" />
            {/* 故障警示胶带 */}
            {t.state === "failed" && <rect className="pod-tape" x="0" y="34" width="120" height="6" />}
          </g>;
        })}
        {waiting > 0 && <text className="pod-more" x="70" y="82">{`+${waiting} 待进给`}</text>}

        {/* 前导轨（遮挡舱体底边） */}
        <g className="m-rail-near">
          <rect x="182" y="128" width="892" height="4" />
          <rect className="m-rail-slot" x="182" y="128" width="892" height="1.5" />
          {railPosts.map(x => <rect key={`n${x}`} x={x} y="132" width="5" height="76" />)}
        </g>
      </g>

      {/* ═══ 出料端：卸料溜槽 / 警示沿 / 收纳箱 / 料位指示 ═══ */}
      <g className="m-output" ref={binRef}>
        <path className="m-chute" d="M1080 146l30 56-12 4-26-50z" />
        <rect className="m-leg" x="1130" y="278" width="14" height="16" />
        <rect className="m-foot" x="1116" y="294" width="42" height="10" rx="1" />
        <rect className="m-hazard" x="1104" y="200" width="64" height="6" />
        <rect className="m-bin" x="1104" y="206" width="64" height="72" rx="2" />
        {/* 收纳箱通风槽 */}
        <path className="m-bin-slots" d="M1114 226h44M1114 244h44M1114 262h30" />
        {/* 料位指示灯 */}
        <rect className="m-bin-lamp" x="1128" y="194" width="16" height="6" rx="1" />
        <text className="m-bin-label" x="1136" y="272" textAnchor="middle">OUT</text>
      </g>
    </svg>
  </section>;
}

function TaskRow({ task, queuePos }: { task: DownloadTask; queuePos: number }) {
  const [retrying, setRetrying] = useState(false);
  const pause = () => window.downloadApi?.pause(task.id);
  const resume = () => window.downloadApi?.resume(task.id);
  const cancel = () => window.downloadApi?.cancel(task.id);
  const reveal = () => { if (task.folder) void window.downloadApi?.showInFolder(task.folder); };
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    const result = await window.downloadApi?.retry(task.id);
    if (!result?.accepted) setRetrying(false);
  };
  const stage = taskStage(task);
  const current = task.state === "queued" || task.state === "cancelled" ? -1 : stage;
  const readout = readoutOf(task);
  const inProgress = task.state === "downloading" || task.state === "paused";
  const isSslError = /CERTIFICATE_VERIFY_FAILED|certificate verify failed/i.test(task.detail ?? "");
  const showActions = inProgress || task.state === "queued" || (task.state === "completed" && task.folder) || task.state === "failed";
  return <article className={`pod pod-${task.state}`}>
    <div className="pod-spine"><i className="pod-lamp" /><ThinkingOrb state={taskOrbStates[task.state]} size={20} theme={document.querySelector(".theme-dark") ? "dark" : "light"} paused={task.state !== "downloading" && task.state !== "queued"} aria-label={`任务状态：${stateLabel(task)}`} /><span className="pod-plate">{platformCopy[task.platform].icon}</span></div>
    <div className="pod-body">
      <div className="pod-head">
        <b>{platformCopy[task.platform].name}</b>
        <span className="pod-meta">{task.createdAt}{queuePos > 0 ? ` · Q${String(queuePos).padStart(2, "0")}` : ""}</span>
        <b className="pod-state">{stateLabel(task)}</b>
      </div>
      <div className="pod-stages" aria-label={`当前阶段：${stage >= 0 ? stageNames[stage] : "未上线"}`}>
        {stageNames.map((name, i) => <span key={name} className={i < stage ? "done" : i === current ? task.state === "failed" ? "fault" : "current" : ""}>{name}</span>)}
      </div>
      <div className="pod-readout">
        {task.state === "downloading" && <b className="pod-pct">{Math.round(task.progress)}%</b>}
        {readout.speed && <span>{readout.speed}</span>}
        {readout.eta && <span>ETA {readout.eta}</span>}
        <span className="pod-detail" title={task.detail}>{readout.text}</span>
      </div>
      <p className="pod-url" title={task.url}>{task.url}</p>
      {inProgress && <div className="pod-progress" aria-label={`下载进度 ${Math.round(task.progress)}%`}><i style={{ width: `${task.progress}%` }}></i></div>}
      {isSslError && <p className="pod-ssl-hint">连接媒体服务器时证书校验失败；请检查 Clash / 代理节点后重试。</p>}
    </div>
    {showActions && <div className="pod-actions">
      {task.state === "downloading" && <button onClick={pause} title="暂停" aria-label="暂停">❚❚</button>}
      {task.state === "paused" && <button onClick={resume} title="继续" aria-label="继续">▶</button>}
      {(inProgress || task.state === "queued") && <button onClick={cancel} title="取消" aria-label="取消">✕</button>}
      {task.state === "completed" && task.folder && <button onClick={reveal} title="打开所在文件夹" aria-label="打开所在文件夹">⤴</button>}
      {task.state === "failed" && <button className="pod-retry" onClick={retry} disabled={retrying} title="重试下载" aria-label="重试下载">{retrying ? "…" : "↻"}</button>}
    </div>}
  </article>;
}

function Empty({ title, text, glyph }: { title: string; text: string; glyph: string }) {
  return <div className="empty"><span>{glyph}</span><h3>{title}</h3><p>{text}</p></div>;
}

export default function App() {
  const [view, setView] = useState<View>("center");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [platform, setPlatform] = useState<Platform>("bilibili");
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("best");
  const [platformAuth, setPlatformAuth] = useState<Record<Platform, boolean>>({
    bilibili: false, douyin: false, youtube: false, instagram: false, xiaohongshu: false, twitter: false,
  });
  const [folder, setFolder] = useState("");
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [notice, setNotice] = useState("传送台已就绪");
  const stats = useMemo(() => ({ queued: tasks.filter(t => t.state === "queued").length, running: tasks.filter(t => t.state === "downloading").length, paused: tasks.filter(t => t.state === "paused").length, done: tasks.filter(t => t.state === "completed").length, failed: tasks.filter(t => t.state === "failed").length }), [tasks]);
  const queueOrder = useMemo(() => tasks.filter(t => t.state === "queued").slice().reverse(), [tasks]);
  const queuePosition = (id: string) => { const index = queueOrder.findIndex(t => t.id === id); return index < 0 ? 0 : index + 1; };
  const completed = tasks.filter(t => t.state === "completed");
  const conveyorState = stats.running ? "downloading" : stats.queued ? "queued" : stats.paused || stats.failed ? "attention" : stats.done ? "complete" : "idle";

  useEffect(() => {
    const api = window.downloadApi;
    if (!api) return;
    api.getDefaultFolder().then(setFolder).catch(() => setFolder("Downloads/云帧下载"));
    void Promise.all((Object.keys(platformCopy) as Platform[]).map(async currentPlatform => {
      const status = await api.getPlatformAuthStatus(currentPlatform);
      setPlatformAuth(current => ({ ...current, [currentPlatform]: status.signedIn }));
    }));
    api.getTasks().then(setTasks).catch(() => setNotice("无法同步任务状态"));
    const stopTasks = api.onTaskUpdate((update) => setTasks(list => {
      const exists = list.some(task => task.id === update.id);
      return exists ? list.map(task => task.id === update.id ? { ...task, ...update } : task) : [update, ...list];
    }));
    const stopAuth = api.onPlatformAuthUpdate(({ platform: updatedPlatform, signedIn }) => {
      setPlatformAuth(current => ({ ...current, [updatedPlatform]: signedIn }));
      setNotice(signedIn ? `${platformCopy[updatedPlatform].name} 登录已完成` : `${platformCopy[updatedPlatform].name} 已退出登录`);
    });
    return () => { stopTasks(); stopAuth(); };
  }, []);

  const chooseFolder = async () => { const selected = await window.downloadApi?.chooseFolder(); if (selected) { setFolder(selected); setNotice("已更新保存位置"); } };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const detected = inferPlatform(url);
    if (!url.trim()) return setNotice("先放入一个公开视频链接");
    if (!folder) return setNotice("正在准备默认保存位置，请稍后重试");
    const effective = detected ?? platform;
    if (detected) setPlatform(detected);
    const taskBrowser = "none";
    const task: DownloadTask = { id: crypto.randomUUID(), url: url.trim(), platform: effective, state: "queued", progress: 0, detail: "等待进入传送带", createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), folder, quality, browser: taskBrowser };
    setTasks(list => [task, ...list]); setUrl(""); setNotice("任务已进入传送带");
    try { await window.downloadApi?.enqueue({ id: task.id, url: task.url, platform: task.platform, folder, quality, browser: taskBrowser }); } catch { setTasks(list => list.map(item => item.id === task.id ? { ...item, state: "failed", detail: "无法把任务交给下载引擎" } : item)); setNotice("任务提交失败"); }
  };

  const header = { center: ["视频下载", "从链接到本地文件。"], history: ["任务记录", "回看本次使用中的下载状态与结果。"], files: ["本地收纳", "已完成的内容会落在你选择的文件夹中。"], settings: ["偏好设置", "调整本机下载服务与默认保存方式。"] }[view];
  const renderCenter = () => <>
    <section className="workbench">
      <div className="composer"><p className="eyebrow">DROP A LINK</p><h2>怎么做</h2><p className="composer-intro">粘贴一个公开分享链接。</p>
        <form onSubmit={submit}><div className="platform-tabs" aria-label="选择平台">{(Object.keys(platformCopy) as Platform[]).map(key => <button type="button" onClick={() => setPlatform(key)} className={platform === key ? "selected" : ""} key={key}><b>{platformCopy[key].icon}</b><span>{platformCopy[key].name}</span></button>)}</div>
          <label className="link-field"><span>视频链接</span><input value={url} onChange={e => setUrl(e.target.value)} placeholder="粘贴公开分享链接" /><button type="submit" aria-label="开始下载">传送 <i>↗</i></button></label><p className="form-hint">{platformCopy[platform].hint} · 将自动识别链接平台</p>
        </form>
        <div className="form-options"><label>清晰度<select value={quality} onChange={e => setQuality(e.target.value)}><option value="best">最佳可用画质</option><option value="2160">4K / 2160p 及以下</option><option value="1080">1080p 及以下</option><option value="720">720p 及以下</option></select></label><div><span>保存到</span><button type="button" onClick={chooseFolder} title={folder}>{folder}<b>更改</b></button></div></div><div className="browser-option"><span>{platformCopy[platform].name} 账号</span><button type="button" onClick={() => window.downloadApi?.startPlatformLogin(platform)}>{platformAuth[platform] ? "已登录 · 重新登录" : platform === "bilibili" ? "扫码登录 B站" : `登录 ${platformCopy[platform].name}`}</button><small>{platformAuth[platform] ? "登录状态已加密保存在本机，下载时会自动使用。" : `登录 ${platformCopy[platform].name} 后，应用会自动使用本地会话处理需要授权的公开视频。`}</small></div>
      </div>
      <Conveyor state={conveyorState} tasks={tasks} />
      <section className="destination"><p className="core-label">结果在哪</p><h3>保存在本地</h3><p>下载完成后，文件会出现在这里。</p><button className="open-folder" onClick={() => window.downloadApi?.showInFolder(folder)}>打开文件夹 ↗</button><span title={folder}>{folder}</span></section>
    </section>
    <section className="queue"><div className="section-title"><div><p className="eyebrow">LIVE MANIFEST</p><h2>正在处理</h2></div><div className="counters"><span>{stats.running} 传送中</span><span>{stats.paused} 已暂停</span><span>{stats.queued} 等待中</span><span>{stats.done} 已收纳</span></div></div>{tasks.length ? <div className="task-list">{tasks.map(task => <TaskRow task={task} key={task.id} queuePos={queuePosition(task.id)} />)}</div> : <Empty glyph="↗" title="传送带还是空的" text="粘贴一个视频链接，第一件媒体包就会从这里启程。" />}</section>
  </>;
  const renderHistory = () => <section className="page-card"><p className="eyebrow">TASK LOG</p><h2>任务记录</h2>{tasks.length ? <div className="task-list">{tasks.map(task => <TaskRow task={task} key={task.id} queuePos={queuePosition(task.id)} />)}</div> : <Empty glyph="◴" title="还没有任务记录" text="新任务会自动同步到这里。" />}</section>;
  const renderFiles = () => <section className="page-card"><div className="file-header"><div><p className="eyebrow">LOCAL ARCHIVE</p><h2>本地收纳</h2></div><button className="quiet-button" onClick={() => window.downloadApi?.showInFolder(folder)}>打开文件夹 ↗</button></div><div className="saved-folder"><span>当前收纳位置</span><b>{folder}</b><button onClick={chooseFolder}>更改位置</button></div>{completed.length ? <div className="task-list">{completed.map(task => <TaskRow task={task} key={task.id} queuePos={0} />)}</div> : <Empty glyph="□" title="收纳盒还是空的" text="完成下载的内容会显示在这里。" />}</section>;
  const renderSettings = () => <section className="page-card settings"><p className="eyebrow">SYSTEM</p><h2>偏好设置</h2><div className="setting-row"><div><b>下载引擎</b><span>使用本机 yt-dlp 解析已支持平台的公开媒体链接。</span></div><code>yt-dlp</code></div><div className="setting-row"><div><b>后端连接</b><span>界面会在启动时同步任务，并持续接收任务状态更新。</span></div><code>IPC READY</code></div><div className="setting-row"><div><b>减少动态效果</b><span>系统开启“减少动态效果”时，传送带会自动停止循环运动。</span></div><code>AUTO</code></div></section>;

  return <main className={`app-shell theme-${theme}`}><aside className="sidebar"><div className="brand"><span className="brand-mark">⌁</span><span>云帧</span><small>FLOW DESK</small></div><nav>{navItems.map(item => <button className={view === item.key ? "active" : ""} onClick={() => setView(item.key)} key={item.key}><i>{item.glyph}</i>{item.label}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setView("settings")} className={view === "settings" ? "active" : ""}><i>·</i>偏好设置</button><small>V 1.0.0 · 铃铛出品</small></div></aside><section className="content"><header><div><p className="eyebrow">PERSONAL MEDIA FLOW</p><h1>{header[0]}</h1><p className="subtle">{header[1]}</p></div><div className="header-actions"><ThinkingOrb state={downloadOrbStates[conveyorState]} size={20} theme={theme} aria-label={notice} style={{ display: "block", flex: "none" }} /><div className={`status state-${conveyorState}`}><i></i>{notice}</div><button className="theme-switch" onClick={() => setTheme(current => current === "light" ? "dark" : "light")}>{theme === "light" ? "深色" : "浅色"}</button></div></header>{view === "center" ? renderCenter() : view === "history" ? renderHistory() : view === "files" ? renderFiles() : renderSettings()}<footer>仅保存你拥有权利的内容 · 不支持绕过平台访问控制、付费墙或 DRM · 铃铛出品</footer></section></main>;
}
