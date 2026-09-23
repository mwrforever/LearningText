/**
 * 交互件类串单一来源（M8 动效与微交互批次）：全站按钮的 hover / 按压 / 焦点 / 禁用纪律
 * 集中在此，禁在消费侧就地改写——本批落地前同一条「工具钮」串在 8 处重复定义、尺寸档
 * 已出现 h-5/h-6/h-7 三档漂移，任何一处纪律调整都需 10 文件扫荡且必然发散。
 *
 * 收录判据（两条任一）：① ≥2 个文件消费；② 必须与兄弟角色保持逐字节一致的按压纪律
 * （如破坏性钮与工具钮构成色彩分级族）。单文件专属且无兄弟纪律要求者不入（欢迎页主钮、
 * 画布浮动钮、树行、标签、搜索结果行等留在原处）。
 *
 * 按压纪律（设计系统文档 §6.2 修订版，M8）：**按下即时、释放平滑**——按压态经
 * `active:duration-0` 令按下瞬间过渡时长为 0（零延迟反馈），指针抬起后该声明失效、回到
 * `duration-100`，回弹走过渡曲线。两类按压形态按前景色对比度分派：
 * —— 纯图标钮（前景为 --muted-foreground）：按压走 `active:scale-95`。不加深表面是因为
 *    --muted-foreground 在按压面（--accent-active）上仅 3.41/4.04，不达正文对比门槛。
 * —— 含文字钮（前景为 --foreground / --primary-foreground）：按压走表面深一档
 *    （--accent-active / primary-80）。文字钮不做缩放——字形重栅格化换来的 2% 位移不值。
 * 行级元素（树行/标签/列表行）一律不加按压态：宽行缩放即抖动，且点击结果（选中/开签/
 * 导航）本身自证，叠按压是重复信号。
 * **20px 级小钮同样豁免**（状态栏图标钮、标签关闭钮、行内「⋯」、toast 动作钮、进度条「取消」）：
 * 命中面小且点击结果即时自证（签消失/菜单展开/面板收起），按压态在该尺寸下既不可辨也不必要
 * ——这是一条显式豁免，不是遗漏。
 *
 * 几何按压在 Tailwind v4 写的是独立 `scale:` 属性（非 `transform`），故图标钮的
 * `transition-colors` 不含它——必须改用显式属性表 `transition-[color,background-color,scale]`，
 * 否则按压与回弹都瞬时跳变（观感退化为「抖一下」）。
 */

/** 图标钮（28px 热区，侧栏头/树工具栏共用）：纯图标、无文字，按压走 scale 路径。
 * shrink-0：侧栏收缩/窄面板下图标钮不得被 flex 挤压变形（宁被裁剪不失形状） */
export const ICON_BUTTON =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-[color,background-color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:scale-95 disabled:pointer-events-none disabled:opacity-40';

/** 工具钮（24px 面板密度，面板工具条与浮层操作通用）：含文字，按压走表面深一档 */
export const TOOL_BUTTON =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-foreground transition-colors duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:bg-accent-active disabled:pointer-events-none disabled:opacity-40';

/** 主操作钮（确认类，与工具钮同尺寸）：按压面取主色 80% 档 */
export const PRIMARY_BUTTON =
  'inline-flex h-6 items-center justify-center rounded-sm bg-primary px-2 text-xs font-medium text-primary-foreground transition-colors duration-100 hover:bg-primary/90 active:duration-0 active:bg-primary/80 disabled:pointer-events-none disabled:opacity-40';

/**
 * 破坏性工具钮（回收站「清空」专用）：与工具钮构成色彩分级族（可逆操作用中性、不可逆
 * 批量操作走破坏色），故独立整串而非模板拼接（拼接会造成 text-* 双类级联歧义）
 */
export const DESTRUCTIVE_BUTTON =
  'inline-flex h-6 items-center justify-center rounded-sm px-2 text-xs font-medium text-destructive transition-colors duration-100 hover:bg-accent hover:text-destructive active:duration-0 active:bg-destructive/15 disabled:pointer-events-none disabled:opacity-40';

/**
 * 活动栏图标钮（40px，三视图 + 设置共用）：纯图标，按压走 scale 路径；激活态高亮由
 * 消费侧的 `aria-current:` / `aria-pressed:` 变体承载（变体排序在基础类之后，天然覆盖）
 */
export const ACTIVITY_BUTTON =
  'relative inline-flex h-10 w-10 items-center justify-center rounded-sm text-muted-foreground transition-[color,background-color,scale] duration-100 hover:bg-accent hover:text-accent-foreground active:duration-0 active:scale-95 aria-current:text-foreground';
