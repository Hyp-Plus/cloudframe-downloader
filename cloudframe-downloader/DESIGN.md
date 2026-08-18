# Design

## Source of truth

- Status: Active
- Last refreshed: 2026-08-09
- Primary product surfaces: 桌面端下载中心、下载记录、本地文件、偏好设置。
- Evidence reviewed:
  - `src/App.tsx`：现有导航、下载表单、任务队列与状态模型。
  - `src/styles.css`：深蓝暗色主题、金色强调色、现有响应式约束。
  - `README.md`：个人授权内容保存、Electron 桌面端与 `yt-dlp` 约束。
- This document governs the redesign named **云端传送带**. It is a product-feedback system, not a decorative animation layer.

## Brand

- Personality: 安静可靠、有工程感、带一点令人愉悦的机械生命力。
- Trust signals: 清晰的任务状态、进度可读性、明确的文件去向、对授权内容的边界说明。
- Avoid:
  - 赛博噪点、夸张霓虹、游戏 HUD、无意义的大面积粒子。
  - 过度拟物的卡通角色，或会让下载状态难以阅读的连续动效。
  - 将平台商标做成官方下载或授权暗示。

## Product goals

- Goals:
  - 让用户不用读文字也能感到“下载正在被处理”。
  - 把抽象的“链接转文件”变成可理解的视觉流程：输入、传送、收纳。
  - 在空闲、排队、下载、成功、失败之间给出不同且可快速扫读的反馈。
  - 保持下载表单和任务队列为首要操作内容。
- Non-goals:
  - 不把产品改造成游戏或宠物应用。
  - 不为每个任务制作独立的长动画，也不以动画替代真实进度数据。
  - 不改变下载能力、平台支持、权限边界或 Electron IPC。
- Success signals:
  - 用户在一秒内能辨别下载中心是否正在工作。
  - 用户在不展开任务详情时能知道当前阶段和已完成数量。
  - 降低动效后仍保留同等完整的状态信息。

## Personas and jobs

- Primary personas: 偶尔保存授权公开视频的个人桌面用户；同时处理少量下载任务的内容整理者。
- User jobs:
  - 粘贴链接，确认任务是否被接收与正在执行。
  - 在等待期间掌握总体进度，而不必盯着每一行文本。
  - 下载完成后确认内容已经进入本地保存位置。
- Key contexts of use: macOS/Windows 桌面窗口，深色环境，通常一次处理 0–5 个任务。

## Information architecture

- Primary navigation: 下载中心、下载记录、本地文件、偏好设置；保持现有结构。
- Core routes/screens:
  - 下载中心：标题和全局状态、云端传送带、链接输入与平台选择、下载参数、任务队列。
  - 下载记录：任务级结果与失败原因；不放持续动效。
  - 本地文件：已完成任务与保存位置；用静态“已归档”状态。
  - 偏好设置：下载引擎、支持的平台；不增加装饰性组件。
- Content hierarchy:
  1. 当前下载状态与下一步操作。
  2. 链接输入和开始下载。
  3. 正在处理的任务及其真实进度。
  4. 已完成数量、画质与保存位置。

## Design principles

- 动画必须叙事：每个运动元素都对应接收、运输、归档或异常之一。
- 状态优先于装饰：文字、色彩、进度与 ARIA 状态是事实来源；动效只作强化。
- 小而完整：传送带是一台紧凑的状态装置，不占据首屏操作区的主导地位。
- 可停靠：没有任务时设备安静待命；动效随任务和系统“减少动态效果”偏好收敛。
- Tradeoffs: 以 CSS/SVG 的轻量可控图形换取较少的写实质感；不引入动画依赖或远程资产。

## Visual language

- Color:
  - 基础背景：`#0B1020`，面板：`#111932` / `#121A32`。
  - 结构线：`#273354`，弱文字：`#8F9CBA`，主文字：`#E9EDF8`。
  - 工作能量色：金色 `#E7B46D`；完成色：薄荷绿 `#66D3A5`；错误色：柔和珊瑚 `#EE8D82`。
  - 传送带上的“媒体包”使用平台的低饱和色块，但不使用平台 logo 作为状态编码。
- Typography: 延续 `Noto Sans SC` 的功能文字与 `Playfair Display` 的标题；数值与状态码使用 `DM Mono`。
- Spacing/layout rhythm: 8px 基础网格；下载中心的主区块间距 24–32px；传送带组件在宽屏为英雄卡右侧 42–48%，窄屏移至表单下方。
- Shape/radius/elevation: 8px 控件圆角、12–16px 面板圆角、低对比 1px 描边；不用明显投影。
- Motion: 默认低速（节奏 1.2–3s），只在状态变化时做一次短促强化；绝不使用无限快速闪烁。
- Imagery/iconography: 纯 CSS/SVG 几何图形。核心视觉是“接收仓、双轨传送带、云端归档盒、状态灯”，不使用插画人物。

## Components

### New: Cloud Conveyor（云端传送带）

- Placement: 下载中心 hero 卡片右半区，与下载表单共处；在 1100px 以下置于表单下方，保持输入框优先。
- Anatomy:
  - **接收仓**：左侧小入口，表示链接已进入处理管线。
  - **传送带**：两条暗金属轨道与三枚滚轮，表示下载传输；中间可携带一个“媒体包”。
  - **媒体包**：带缩略纹理的 24–32px 小卡片，标签为当前平台简称或通用文件图标。
  - **归档盒**：右侧半透明云端盒，代表本地文件库；完成时接收媒体包。
  - **状态灯与小标签**：组件底部始终展示文字状态及任务数，不能只依赖色彩。
- Variants and states:
  - `idle`：滚轮静止，媒体包停在接收仓旁；状态为“传送带待命”。仅有极轻的状态灯呼吸光。
  - `queued`：接收仓亮起，媒体包缓慢移至传送带起点；状态为“正在准备 N 个任务”。
  - `downloading`：滚轮、传送带和媒体包匀速运动；档案盒有微弱接收光；显示“正在传送 · N 个任务”。
  - `success`：媒体包进入归档盒，盒子闪一次薄荷绿描边，出现“已归档”短标签（600ms 后淡出）。
  - `failed`：传送带暂停，接收仓显示珊瑚色提示点；状态为“有 N 个任务需要处理”。不使用抖动或警报式闪烁。
  - `reduced-motion`：禁止轨道、滚轮、媒体包的循环移动；保留颜色、静态位置、文字和一次性淡入。
- Data contract:
  - `tasks` 是唯一状态来源。
  - `downloading` 数量决定是否驱动循环动效。
  - `queued` 数量决定准备态；`completed` 的新增任务触发一次成功态；`failed` 数量触发失败提示。
  - 组件不得伪造百分比；单任务真实进度仍由任务列表展示。

### Existing components to reuse

- `hero-card`：承载首屏的渐变背景与主要操作。
- `download-form`：保持平台选择、链接输入与主操作按钮。
- `TaskRow`：继续作为精确进度与详情的可访问列表项。
- `status`：升级为全局状态文字，和 Cloud Conveyor 使用同一状态文案来源。

### Changed component behavior

- 下载按钮提交成功后：按钮保持原位置；全局状态变为“任务已进入传送带”，传送带由 idle/queued 切换。
- 开始实际下载后：全局状态与传送带切换为 downloading；队列行显示百分比。
- 全部完成后：播放一次归档反馈，随后回到 idle，并在归档盒旁保留“本次已收纳 N 个文件”的静态摘要。
- 有失败任务时：不遮挡其他任务和表单；将失败提示放在状态灯旁，并保留失败列表入口。

## Accessibility

- Target standard: WCAG 2.1 AA（在 Electron 可用范围内）。
- Keyboard/focus behavior: 传送带是非交互展示，不能抢占 Tab 焦点；表单、导航、目录选择保留清晰 `:focus-visible`。
- Contrast/readability: 所有状态均以文字、图标形状和颜色三重表达；小号说明文字保持至少 4.5:1 对比度。
- Screen-reader semantics: 传送带容器使用简短的 `role="status"` / `aria-live="polite"` 状态摘要；装饰性轨道、滚轮、蒸汽等元素设 `aria-hidden="true"`。
- Reduced motion and sensory considerations: `prefers-reduced-motion: reduce` 下移除循环运动、缩短过渡且停止发光脉冲。

## Responsive behavior

- Supported breakpoints/devices: 桌面端最小宽度 950px；优化 1100px 以上窗口。
- Layout adaptations:
  - `>= 1100px`：英雄区为文案/表单与传送带并列，传送带最大宽度约 430px。
  - `950–1099px`：传送带移至表单下方，横向占满且高度收紧；导航与队列结构不变。
- Touch/hover differences: 不以 hover 表达关键信息；按钮 hover 仅作可选增强。

## Interaction states

- Loading: Electron 初始化或尚无任务时显示 idle，不展示假进度。
- Empty: 保留现有空队列，但文案与传送带对应为“还没有货物进入传送带”。
- Error: 失败任务显示具体错误摘要；传送带只标示存在异常，不能替代错误原因。
- Success: 首次完成时执行一次 400–600ms 归档收纳；之后任务行仍显示“完成”。
- Disabled: 没有可用链接时可禁用开始下载，附带“粘贴链接后可开始”的辅助文案。
- Offline/slow network: 如果下载层可提供此信号，使用“传送暂停，正在等待网络”的静态黄灯状态；当前数据模型没有该状态，不先行伪造。

## Content voice

- Tone: 平静、清楚、有微小的机械隐喻，但不过度拟人。
- Terminology: 使用“传送带、任务、已收纳、本地文件”；避免“抓取、破解、搬运盗版”等表达。
- Microcopy rules:
  - 状态文案不超过 16 个中文字符的主句，任务数量可作为次句。
  - 动作优先：`正在传送`、`等待进入`、`已收纳`、`需要处理`。
  - 不把技术错误原文作为主状态；在任务详情中保留可诊断信息。

## Implementation constraints

- Framework/styling system: React + TypeScript + 单一原生 CSS 文件；不引入动画库。
- Design-token constraints: 先在 `styles.css` 中归纳现有色值为 CSS 自定义属性，再由传送带复用；不要新增第二套主题。
- Performance constraints: 仅对 `transform`、`opacity` 和必要的背景位置做动画；同时活动的媒体包最多 3 个；禁止轮询和 JavaScript 动画帧循环。
- Compatibility constraints: Electron Chromium；需支持 `prefers-reduced-motion`。
- Test/screenshot expectations:
  - 覆盖 idle、queued、downloading、success、failed 与 reduced-motion 的视觉/DOM 状态。
  - 验证提交、任务进度更新、目录选择、导航和队列功能未回归。

## Open questions

- [ ] 是否要为每个平台提供不同的“媒体包”色卡，还是统一为中性文件卡？Owner: 产品。Impact: 中。
- [ ] “归档盒”应表达本地文件夹还是云端中转语义？建议文案明确为“本地收纳盒”，避免与在线存储混淆。Owner: 产品。Impact: 中。
- [ ] 是否在成功后提供“在访达/资源管理器中查看”快捷操作？这需要主进程 IPC 能力，当前不在本次视觉改版范围。Owner: 产品/工程。Impact: 中。
