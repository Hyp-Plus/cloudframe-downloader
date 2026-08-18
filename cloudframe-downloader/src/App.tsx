import { FormEvent, useEffect, useMemo, useState } from "react";
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

function Conveyor({ state, tasks }: { state: "idle" | "queued" | "downloading" | "complete" | "attention"; tasks: DownloadTask[] }) {
  const inFeed = tasks.filter(t => t.state === "queued" || t.state === "downloading");
  const queued = tasks.filter(t => t.state === "queued").slice().reverse(); // 先到先上料
  const working = tasks.filter(t => t.state === "downloading" || t.state === "paused" || t.state === "failed");
  const exited = tasks.filter(t => t.state === "completed").slice(0, 1); // 最近一件做出料归档动画
  // 安全间距：从最靠近出料端的舱体开始，向左逐个保证 gap 间距
  let guard = Number.POSITIVE_INFINITY;
  const pods = [
    ...[...working, ...exited].map(task => ({ task, ideal: podTargetX(task, 0) })),
    ...queued.map((task, queueIndex) => ({ task, ideal: podTargetX(task, queueIndex) })),
  ]
    .sort((a, b) => b.ideal - a.ideal)
    .map(p => { const x = Math.min(p.ideal, guard - LINE.gap); guard = x; return { task: p.task, x }; });
  const visiblePods = pods.filter(p => p.x > -LINE.podW);
  const waiting = pods.length - visiblePods.length;
  const sensorOn = (sx: number) => visiblePods.some(p => p.task.state !== "queued" && p.x < sx + 8 && p.x + LINE.podW > sx - 8);
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
  const bolts = [310, 400, 490, 680, 770, 860, 950, 1020];
  const ruler = Array.from({ length: 40 }, (_, i) => 198 + i * 22).map((x, i) => `M${x} 211v${i % 5 === 0 ? 5 : 3}`).join("");
  const railPosts = [250, 480, 710, 940];
  const idlers = [320, 440, 560, 680, 800, 920];
  const zones = [{ x: 198, w: 150 }, { x: 400, w: 330 }, { x: 780, w: 120 }, { x: 940, w: 120 }];
  return <section className={`conveyor conveyor-${state} stage-${stage}`} aria-label={copy} role="status">
    <div className="conveyor-head">
      <ThinkingOrb state={downloadOrbStates[state]} size={64} theme={document.querySelector(".theme-dark") ? "dark" : "light"} aria-label={copy} style={{ position: "absolute", top: 24, right: 24 }} />
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
        <pattern id="cf-hazard" width="10" height="10" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect className="hz-a" width="10" height="10" /><rect className="hz-b" width="5" height="10" />
        </pattern>
        <pattern id="cf-hatch" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <rect className="ht-a" width="7" height="7" /><rect className="ht-b" width="3" height="7" />
        </pattern>
      </defs>
      <path className="m-floor" d="M16 306h1168" />

      {/* 机架：支腿、横梁、翼缘、斜撑、焊缝、维护刻度、资产铭牌、张力表 */}
      <g className="m-frame">
        <rect className="m-leg" x="200" y="244" width="18" height="54" />
        <rect className="m-leg" x="1036" y="244" width="18" height="54" />
        <path className="m-brace" d="M218 250l818 42M218 292l818-42" />
        <rect className="m-foot" x="188" y="298" width="42" height="8" />
        <rect className="m-foot" x="1024" y="298" width="42" height="8" />
        <rect className="m-girder" x="196" y="214" width="876" height="30" />
        <rect className="m-flange" x="186" y="208" width="896" height="6" />
        <path className="m-ruler" d={ruler} />
        <path className="m-weld" d="M420 218v22M640 218v22M860 218v22" />
        {bolts.map(x => <g className="m-bolt" key={x}><circle cx={x} cy="229" r="2.6" /><circle cx={x} cy="229" r="1" /></g>)}
        <g className="m-tension">
          <text className="m-gauge-label" x="257" y="206" textAnchor="middle">TENSION</text>
          <rect className="m-plate" x="228" y="220" width="58" height="16" rx="1" />
          <path className="m-ticks" d="M236 224v4M242 224v4M248 224v4M254 224v6M260 224v4M266 224v4M272 224v4M278 224v6" />
          <g className="m-tension-pointer"><path d="M230 233l6-4v8z" /></g>
        </g>
        <g className="m-asset">
          <rect x="540" y="220" width="120" height="18" rx="1" />
          <text x="600" y="232" textAnchor="middle">CF-01 · FLOW LINE</text>
        </g>
        {stageNames.map((name, i) => <g className={`m-station station-${i}`} key={name}>
          <rect x={zones[i].x} y="246" width={zones[i].w} height="24" rx="1" />
          <text x={zones[i].x + zones[i].w / 2} y="262" textAnchor="middle">{`ST-0${i + 1} ${name}`}</text>
        </g>)}
      </g>

      {/* 上料控制台：信标灯柱、屏幕、LED 排、按键、散热槽 */}
      <g className="m-console">
        <rect className="m-leg" x="36" y="240" width="14" height="58" />
        <rect className="m-foot" x="24" y="298" width="38" height="8" />
        <rect className="m-housing" x="16" y="150" width="56" height="92" rx="2" />
        <rect className="m-screen" x="24" y="160" width="40" height="24" rx="1" />
        <path className="m-screen-line" d="M28 168h24M28 175h32" />
        <circle className="m-led" cx="28" cy="196" r="2.5" />
        <circle className="m-led m-led-run" cx="40" cy="196" r="2.5" />
        <circle className="m-led" cx="52" cy="196" r="2.5" />
        <circle className="m-key" cx="27" cy="214" r="4" />
        <circle className="m-key" cx="39" cy="214" r="4" />
        <circle className="m-key m-key-signal" cx="51" cy="214" r="4" />
        <path className="m-vents" d="M24 226h32M24 231h32M24 236h32" />
        <rect className="m-mast" x="40" y="66" width="4" height="84" />
        <rect className="m-beacon-housing" x="32" y="40" width="20" height="26" rx="3" />
        <circle className="m-beacon" cx="42" cy="52" r="6.5" />
      </g>

      {/* 上料辊床（无动力区）+ 限位挡块 */}
      <g className="m-apron">
        <rect className="m-apron-bed" x="76" y="146" width="100" height="8" />
        {[88, 110, 132, 154].map(x => <g className="m-idler" key={x}><circle cx={x} cy="146" r="6" /><path d={`M${x} 142v8M${x - 4} 146h8`} /></g>)}
        <rect className="m-hazard" x="76" y="146" width="6" height="8" />
      </g>
      <g className="m-endstop">
        <rect x="56" y="116" width="8" height="24" rx="1" />
        <rect className="m-hazard" x="56" y="116" width="8" height="7" />
      </g>

      {/* 输送线体：回程带、滚筒、托辊、工作面带、光电传感器、导轨 */}
      <g className="m-line">
        <rect className="m-belt-return" x="204" y="198" width="848" height="8" />
        <path className="m-tread-return" d="M204 202h848" />
        {idlers.map(x => <g className="m-idler" key={x}>
          <circle cx={x} cy="163" r="11" />
          <path d={`M${x} 156v14M${x - 7} 163h14`} />
        </g>)}
        <g className="m-roller m-roller-tail">
          <circle cx="210" cy="172" r="32" />
          <path d="M210 148v48M186 172h48M193 155l34 34M227 155l-34 34" />
          <circle className="m-hub" cx="210" cy="172" r="6" />
        </g>
        <g className="m-roller m-roller-drive">
          <circle cx="1046" cy="172" r="32" />
          <path d="M1046 148v48M1022 172h48M1029 155l34 34M1063 155l-34 34" />
          <circle className="m-hub" cx="1046" cy="172" r="6" />
        </g>
        <g className="m-motor">
          <rect x="1026" y="206" width="40" height="26" rx="2" />
          <path d="M1032 212v14M1039 212v14M1046 212v14" />
        </g>
        <rect className="m-belt-top" x="176" y="140" width="904" height="12" />
        <path className="m-belt-edge" d="M176 140.5h904" />
        <path className="m-tread-top" d="M176 146h904" />
        {sensorXs.map(sx => <g className={`m-sensor${sensorOn(sx) ? " on" : ""}`} key={sx}>
          <rect className="m-sensor-post" x={sx - 2} y="110" width="4" height="98" />
          <rect className="m-sensor-head" x={sx - 6} y="96" width="12" height="14" rx="2" />
          <circle className="m-sensor-led" cx={sx} cy="102" r="2.6" />
          <path className="m-sensor-beam" d={`M${sx} 110v30`} />
        </g>)}
        <g className="m-rail-rear">
          <rect x="182" y="116" width="892" height="4" />
          <rect className="m-rail-slot" x="182" y="116" width="892" height="1.5" />
          {railPosts.map(x => <rect key={x} x={x} y="120" width="5" height="88" />)}
        </g>

        {/* 任务舱：位置由真实状态与 progress 驱动，CSS translate 过渡产生机械式加减速 */}
        {visiblePods.map((p, i) => {
          const t = p.task;
          const pct = Math.min(100, Math.max(0, t.progress));
          return <g className="pod-pos" key={t.id} style={{ translate: `${p.x}px ${LINE.podY}px` }}>
            <g className={`pod-g pod-${t.state}`}>
              <rect className="pod-shadow" x="4" y="50" width="112" height="5" />
              <rect className="pod-skirt" x="0" y="42" width="120" height="8" />
              <rect className="pod-chassis" x="0" y="6" width="120" height="38" rx="2" />
              <rect className="pod-deck" x="0" y="6" width="120" height="7" />
              <rect className="pod-clasp" x="28" y="3" width="9" height="4" rx="1" />
              <rect className="pod-clasp" x="83" y="3" width="9" height="4" rx="1" />
              <rect className="pod-bumper" x="0" y="16" width="3" height="20" />
              <rect className="pod-bumper" x="117" y="16" width="3" height="20" />
              {[[7, 12], [113, 12], [7, 38], [113, 38]].map(([cx, cy]) => <g className="pod-bolt" key={`${cx}-${cy}`}><circle cx={cx} cy={cy} r="2" /><circle cx={cx} cy={cy} r=".8" /></g>)}
              <rect className="pod-plate" x="9" y="15" width="28" height="21" rx="1" />
              <text className="pod-code" x="23" y="29" textAnchor="middle">{platformCopy[t.platform].icon}</text>
              <text className="pod-idx" x="44" y="22">{`UNIT-${String(visiblePods.length - i).padStart(2, "0")}`}</text>
              {pct > 0 && <text className="pod-pct" x="99" y="22" textAnchor="end">{`${Math.round(pct)}%`}</text>}
              <rect className="pod-slot" x="44" y="27" width="66" height="9" rx="1" />
              {pct > 0 && <rect className="pod-fill" x="45.5" y="28.5" width={Math.max(1.5, 63 * pct / 100)} height="6" />}
              <rect className="pod-lamp" x="104" y="15" width="7" height="7" rx="1" />
              {t.state === "failed" && <rect className="pod-tape" x="0" y="34" width="120" height="6" />}
            </g>
          </g>;
        })}
        {waiting > 0 && <text className="pod-more" x="80" y="84">{`+${waiting} 待进给`}</text>}

        <g className="m-rail-near">
          <rect x="182" y="128" width="892" height="4" />
          <rect className="m-rail-slot" x="182" y="128" width="892" height="1.5" />
          {railPosts.map(x => <rect key={x} x={x} y="132" width="5" height="76" />)}
        </g>
      </g>

      {/* 出料端：卸料溜槽、警示沿、收纳箱 */}
      <g className="m-output">
        <path className="m-chute" d="M1080 146l30 56-12 4-26-50z" />
        <rect className="m-leg" x="1130" y="280" width="14" height="18" />
        <rect className="m-foot" x="1118" y="298" width="42" height="8" />
        <rect className="m-hazard" x="1104" y="202" width="64" height="6" />
        <rect className="m-bin" x="1104" y="208" width="64" height="72" rx="2" />
        <path className="m-bin-slots" d="M1114 226h44M1114 240h44M1114 254h44" />
        <rect className="m-bin-lamp" x="1129" y="196" width="14" height="6" rx="1" />
        <text className="m-bin-label" x="1136" y="273" textAnchor="middle">OUT</text>
      </g>
    </svg>
  </section>;
}

function TaskRow({ task, queuePos }: { task: DownloadTask; queuePos: number }) {
  const pause = () => window.downloadApi?.pause(task.id);
  const resume = () => window.downloadApi?.resume(task.id);
  const cancel = () => window.downloadApi?.cancel(task.id);
  const reveal = () => { if (task.folder) void window.downloadApi?.showInFolder(task.folder); };
  const stage = taskStage(task);
  const current = task.state === "queued" || task.state === "cancelled" ? -1 : stage;
  const readout = readoutOf(task);
  const inProgress = task.state === "downloading" || task.state === "paused";
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
    </div>
    {(inProgress || task.state === "queued" || (task.state === "completed" && task.folder)) && <div className="pod-actions">
      {task.state === "downloading" && <button onClick={pause} title="暂停" aria-label="暂停">❚❚</button>}
      {task.state === "paused" && <button onClick={resume} title="继续" aria-label="继续">▶</button>}
      {(inProgress || task.state === "queued") && <button onClick={cancel} title="取消" aria-label="取消">✕</button>}
      {task.state === "completed" && task.folder && <button onClick={reveal} title="打开所在文件夹" aria-label="打开所在文件夹">⤴</button>}
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

  return <main className={`app-shell theme-${theme}`}><aside className="sidebar"><div className="brand"><span className="brand-mark">⌁</span><span>云帧</span><small>FLOW DESK</small></div><nav>{navItems.map(item => <button className={view === item.key ? "active" : ""} onClick={() => setView(item.key)} key={item.key}><i>{item.glyph}</i>{item.label}</button>)}</nav><div className="sidebar-bottom"><button onClick={() => setView("settings")} className={view === "settings" ? "active" : ""}><i>·</i>偏好设置</button><small>V 0.2.0 · DESKTOP</small></div></aside><section className="content"><header><div><p className="eyebrow">PERSONAL MEDIA FLOW</p><h1>{header[0]}</h1><p className="subtle">{header[1]}</p></div><div className="header-actions"><ThinkingOrb state={downloadOrbStates[conveyorState]} size={20} theme={theme} aria-label={notice} style={{ display: "block", flex: "none" }} /><div className={`status state-${conveyorState}`}><i></i>{notice}</div><button className="theme-switch" onClick={() => setTheme(current => current === "light" ? "dark" : "light")}>{theme === "light" ? "深色" : "浅色"}</button></div></header>{view === "center" ? renderCenter() : view === "history" ? renderHistory() : view === "files" ? renderFiles() : renderSettings()}<footer>仅保存你拥有权利的内容 · 不支持绕过平台访问控制、付费墙或 DRM</footer></section></main>;
}
