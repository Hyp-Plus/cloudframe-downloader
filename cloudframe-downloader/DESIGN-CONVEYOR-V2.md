# DESIGN-CONVEYOR-V2 · 下载任务区「工业输送线」重设计

- Status: Implemented（typecheck 通过；idle 已真机验收，downloading/complete 有离屏截图）
- Date: 2026-08-16（v2.1 构图修订、v2.2 双主题，同日完成）
- Scope: 下载任务区整体视觉语言推翻重建 —— 传送带组件（Conveyor）+ 任务行（TaskRow → 任务舱）。
  不涉及：下载核心逻辑、Electron IPC、构建配置、`electron/` 后端代码、表单与导航区域。

---

## 0.3 v2.2 双主题（2026-08-16，响应"传送带写死深色"反馈）

**做法**：机床全部颜色抽为 `--m-*` 语义令牌，定义在 `.conveyor` 上（默认值 = 深色工业控制台，
与 .theme-dark 一致）；`.theme-light .conveyor` 整套覆写令牌值。SVG 渐变 stop 改为 CSS 类
着色（`stop-color: var(--m-*)`），因此机架/皮带/滚筒渐变也随主题切换。任务舱同理令牌化为
`--p-*`（`task-pods.css`），操作键（`task-actions.css`）继承同一组令牌。

**浅色主题不是反色，是一台浅色设备**：
- 机身/面板：暖灰 `#e9e7e2` / `#f5f4f1`；结构件：拉丝铝 `#c9cccf`、机架渐变 `#d5d8db→#b0b4b8`；
- 轮廓与文字反转为深灰系（`--m-edge:#6b7076`、`--m-silver:#3c4147`、`--m-head:#23272b`），保证对比度；
- **保持深色的部件（真实设备逻辑）**：皮带工作面（深色橡胶 `#41474e→#262b30`）、回程带、
  控制台屏幕、舱体进度槽（`--m-deep:#2b2f33`）；
- 前后景关系保留：前导轨深、后导轨浅，滚筒径向渐变 `#dcdee1→#989ea4`，螺栓/刻度清晰。
- 琥珀 `#ffb020` 语义双主题完全一致（节奏分工况：呼吸=运行、慢闪=排队、双闪=异常）。

**改动面**：`src/conveyor-motion.css`、`src/task-pods.css`、`src/task-actions.css` 全部令牌化；
`src/App.tsx` 仅 `<defs>` 三个渐变的 stop 改为 class 着色（无逻辑改动）。
任务舱在浅色主题下从"黑色数据模块"变为"拉丝铝托盘"，与机身统一。

**主题切换触发面**：容器背景/文字、SVG 机架/皮带/滚筒/导轨/铭牌/工位牌/控制台/张力标尺/
出料箱、上线舱体、任务列表舱体与操作键——全部跟随 `.app-shell` 的 `theme-light/theme-dark`。

---

## 0. v2.1 构图修订（2026-08-16，响应真机复核反馈）

**根因发现（重要）**：v2 首版"上半部大片黑色面板、机械被压在底部"的主因不只是视窗排布——
`styles.css` 旧规则 `.conveyor-caption{position:absolute;left:27px;bottom:110px}` 与新规则的
`right:28px;top:24px` 叠加后，caption 被拉成覆盖组件上半部的**整幅不透明面板**（背景色 +
边框 + z-index 2），把铭牌头和机床上半部整个罩住了。v2.1 在新规则中显式 `left:auto;bottom:auto`
抵消。**复核 styles.css 清理死规则时请优先删除该条（见第 7 节）。**

**构图调整**：
- SVG 视窗 `1200×420` → `1200×330`，整机 y 轴上移重排：信标顶 y=14，皮带工作面 y=140，
  机架 y=214，地坪线 y=306。机械主体（含信标与支腿）占视窗约 88%，工作区（舱体+皮带+机架）
  占组件高度约 65%，达标 60–70% 目标。
- 明暗分层：机架/支腿用竖向钢渐变 `cf-steel`，皮带用 `cf-belt` 渐变 + 顶部高光棱线
  `.m-belt-edge`，滚筒用径向渐变 `cf-roller`；前导轨亮银 `#8d969f`、后导轨压暗 `#4a525a`
  形成前后景；拖板纹提亮至 `#9aa3ab`；螺栓、轴毂描边全部提亮一档。
- 背景增加中心径向微光，避免"纯黑仪表屏"感。

**截图复核**：`preview/conveyor-downloading.png`、`preview/conveyor-complete.png`
（由 `scripts/capture-conveyor.cjs` 离屏渲染 `preview/conveyor-states.html` 生成；
舱体/工位牌/导轨互不遮挡，上料→舱体→出料箱横向流向清晰）。
注意：同窗口二次加载需用 query 传参（hash 导航不触发重渲染）；该目录为复核工具，
集成方可整体删除 `preview/` 与 `scripts/capture-conveyor.cjs`。

---


## 1. 设计概念

从「卡通线稿传送带」推翻为 **一台高端工业自动化设备的控制界面**（参考 CNC 面板、精密输送线、
机场分拣系统）。核心隐喻：**下载任务是在输送线上被加工的任务舱（Unit），沿 解析 → 下载 → 转码 → 入库
四个工位顺序推进，最终由出料端落入本地收纳箱。**

设备编号 `FLOW LINE · CF-01`，界面文案采用「机器码 + 中文工况」双语（如 `RUN · 正在传送 2 个任务`）。

## 2. 机械逻辑（装配关系）

SVG 视图 `0 0 1200 330`（v2.1 起），部件均有真实装配关系，不再是漂浮元素：

| 部件 | 实现 |
| --- | --- |
| 机架 | 横梁 + 上翼缘板 + 支腿 + 地脚板 + X 形斜撑 + 一排螺栓头 |
| 皮带 | 工作面带（上）+ 回程带（下），各带连续拖板纹（tread） |
| 滚筒 | 尾轮（左 r32）与驱动轮（右 r32，下方挂驱动电机盒），6 枚托辊（r11）托住工作面带 |
| 联动 | 滚筒转速按半径比换算：主滚筒 2.2s/圈，托辊 0.76s/圈（32:11） |
| 导轨 | 后侧导轨（舱体后方）+ 前侧导轨（遮挡舱体底边），立柱固定到机架 |
| 张力结构 | 尾轮旁的张力标尺，指针位置随机况移动（停机松弛 → 运行张紧） |
| 工位刻度 | 机架下方 4 块工位牌 ST-01 解析 / ST-02 下载 / ST-03 转码 / ST-04 入库，当前工位点亮 |
| 上料端 | 控制台（屏幕、按键、信标灯柱）+ 进料溜槽 |
| 出料端 | 卸料溜槽 + 收纳箱（OUT），完成时信标与箱灯点亮、箱体贴合动画一次 |

## 3. 任务舱（Unit）

- **上线舱体（SVG）**：真实任务按队列顺序上线，最久的任务最靠近出料端（FIFO）；
  最多同时在线 4 舱，超出时上料口显示 `+N 待进给`。舱体含：底盘、顶沿、四颗螺栓、
  平台铭牌（平台缩写）、编号（UNIT-01…）、进度槽（下载中按真实 progress 填充）、状态灯。
- **列表舱体（TaskRow，DOM）**：左舷 = 状态灯 + 平台铭牌；舱体 = 平台/时间/队列位（Q01…）→
  工位条 → 读数行（进度% / 速度 / ETA / 详情）→ URL → 铣槽进度轨；右舷 = 操作键区。
- 读数从后端 `detail`（yt-dlp 原始输出）中正则提取速度（`x.x MiB/s`）与 `ETA`，
  不伪造数据；提取不到时回退为截断的原始详情文本。
- 工位推断（`taskStage`）：`completed`→入库；detail 含 `merg/合并/转码`→转码；
  含 `[download] x%` 或 progress>2→下载；其余→解析。仅作展示，数据源仍是后端 state/detail。

## 4. 色彩 / 排版 / 动效规则

**色彩（单一工业信号色 + 双主题令牌）**

- 双主题令牌：全部机床颜色为 `--m-*` 语义令牌（`conveyor-motion.css`），深色为默认；
  `.theme-light .conveyor` 整套覆写（见 0.3 节）。深色主题：背景石墨 `#14171a`，
  面板 `#1b1f24`，钢 `#2e343b`，高光 `#454e57`，边缘 `#59636d`，标注银 `#aeb6be`。
- 唯一信号色：琥珀 `#ffb020`。所有工况（运行/排队/暂停/完成/故障）只用这一种颜色，
  靠**节拍**区分（见下）；故障辅以 45° 斜纹 hatch（工业警示带语义）。

**排版**

- 数据与机器码：`DM Mono`（进度、速度、ETA、编号、工位牌）；中文工况：`Noto Sans SC`。
- 层级：工位条（阶段）→ 读数行（进度/速度/ETA/队列位）→ 操作键；说明文字最小 9px，
  全部辅以文字而非仅颜色表达。

**几何**

- 圆角上限 3px（灯、键 1–2px）；面板硬边 + 1–1.5px 描边；无柔和投影，仅用接触阴影。

**动效（克制、可解释的机械运动）**

| 工况 | 信标/灯节拍 | 机械运动 |
| --- | --- | --- |
| 空闲 idle | 灯灭 | 全线静止，张力指针落底 |
| 排队 queued | 慢闪（1.8s 占空） | 皮带静止，舱体上线滑入一次，张力指针中段 |
| 下载 downloading | 常亮慢呼吸（2.4s） | 皮带连续走带、滚筒联动、当前工位牌点亮、张力张紧 |
| 暂停/异常 attention | 双闪报警（1s 双脉冲） | 全线停车，张力指针回落 |
| 完成 complete | 常亮 | 收纳箱 600ms 贴合一闪，随后回落 |

- 状态切换过渡统一 240–480ms `cubic-bezier(.3,.9,.25,1)`（机械式急启稳停）。
- `prefers-reduced-motion`：全线停车、禁闪烁，保留静态工况（灯位、张力指针、工位点亮）。

## 5. 状态与响应式覆盖

- 五态：空闲 / 排队 / 下载中（信标+走带+舱体进度）/ 完成（出料端反馈）/ 失败与暂停（HOLD 双闪）。
- 双主题：深色 = 深石墨工业控制台；浅色 = 暖灰机身 + 拉丝铝结构（皮带/屏幕/槽孔保持深色）；
  任务舱同步为枪灰 / 拉丝铝两套，切换由 `.app-shell` 的 theme 类驱动。
- 窄屏 ≤1100px：工作台收单列，输送线移至表单下方完整保留（覆盖 styles.css 中旧的 `display:none`），
  铭牌头换行、工况读数落为行内；任务舱读数行换行、详情独占一行。

## 6. 改动文件清单

| 文件 | 改动 |
| --- | --- |
| `src/App.tsx` | 仅重写 `Conveyor`、`TaskRow` 两个组件；新增 `taskStage` / `readoutOf` / `stateLabel` / `podSlots` 展示层辅助函数；`Conveyor` 入参改为 `tasks`；三处 `<TaskRow>` 调用增加 `queuePos`；删除随之失效的 `stateCopy`、`activeTask` 及未再使用的 `TaskState` 导入。其余（表单、导航、页面、IPC 调用）未动。 |
| `src/conveyor-motion.css` | 整体推翻重写为工业输送线样式；**原样保留**了文件末尾与本组件无关的 `.browser-option` 三条规则。 |
| `src/task-pods.css` | **新增**：任务舱（TaskRow）全部样式与五态节拍。 |
| `src/task-actions.css` | 重写：原 `.task-actions` 类已不存在，改为任务舱操作键 `.pod-actions` 样式。 |
| `src/main.tsx` | 新增一行 `import "./task-pods.css";`。 |
| `preview/conveyor-states.html` + `scripts/capture-conveyor.cjs` | **新增**（v2.1）：离屏截图复核工具，`npx electron scripts/capture-conveyor.cjs` 生成各工况 PNG；纯工具，可整体删除。 |
| `preview/conveyor-*.png` | 下载中 / 完成态复核截图。 |
| `DESIGN-CONVEYOR-V2.md` | **新增**：本文档。 |

未改动：`src/download.ts`、`electron/`、`vite.config.mts`、`package.json`、`src/styles.css`、
`index.html`、其余页面与表单样式。

## 7. 需要集成方复核 / 集成的事项

1. **验证状态**：v2.1 后 `npx tsc --noEmit` 已通过（2026-08-16）；建议再跑一次
   `npm run build` 确认产物，并在真机过一遍五态（目前 idle 真机验收，downloading/complete 为截图复核）。
2. **styles.css 遗留死规则（建议清理，未动）**：第 6 行旧传送带 DOM 版样式
   （`.intake` / `.belt` / `.parcel` / `.archive`、`.conveyor-caption` 的 `left:27px;bottom:110px`
   及相关 keyframes `parcel-run`），以及第 7 行旧任务行样式
   （`.task` / `.platform-icon` / `.task-main` / `.progress` / `.task-state`）。
   对应 DOM 类已不存在，属死代码。**其中旧 `.conveyor-caption` 的 left/bottom 偏移曾与新规则叠加
   把 caption 拉成整幅遮挡面板（v2.1 已用 `left:auto;bottom:auto` 防御），删除旧规则后该防御可保留。**
   删除前请全局确认无引用。
3. **行为微调（请确认）**：任务舱对 `queued` 状态也提供「取消」键（后端 `cancel` 已支持 queued，
   见 `electron/main.ts:140`）；`completed` 任务新增「打开所在文件夹」键，复用现有
   `showInFolder(task.folder)`。均为现有 IPC，无后端改动。
4. **文案变更**：任务状态码由「已收纳/需要处理」等改为机器语感（排队/故障/已入库）；
   传送带标题与 caption 改为「机器码 · 中文」双语。如需与全局文案统一可直接改
   `App.tsx` 中 `stateLabel` 与 `Conveyor` 的 `copy`。
5. **信号色语义**：按要求全机仅用琥珀 `#ffb020` 表达一切工况（含故障，用双闪+斜纹区分）。
   若后续认为故障需要红色，只需改 `.pod-failed` / `.conveyor-attention` 两条规则。
6. **性能**：上线舱体上限 4 个（`podSlots`），超出折叠为 `+N 待进给`；全部动效为 CSS，
   无 JS 动画循环，符合 DESIGN.md 的性能约束。
