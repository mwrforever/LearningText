/**
 * 三栏布局纯函数（M4 spec §5.1 D5）：宽度比例合法域 0.15–0.6（编辑器自适应占余）；
 * 指针→比例换算带钳制（拖拽分隔条用），零宽容器（折叠态/未布局）返下界防除零。
 */
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.6;

/** 比例钳制到合法域 [0.15, 0.6]：越界双向收敛，域内原样返回 */
export function clampRatio(ratio: number): number {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/**
 * 指针偏移换算栏宽比例并钳制：offsetPx 为指针到容器起始边缘的距离（树栏取左缘、
 * 预览栏取右缘镜像），containerWidth 为宿主容器宽；零宽容器（折叠态/未布局）返下界防除零
 */
export function ratioFromPointer(containerWidth: number, offsetPx: number): number {
  if (containerWidth <= 0) return MIN_RATIO;
  return clampRatio(offsetPx / containerWidth);
}
