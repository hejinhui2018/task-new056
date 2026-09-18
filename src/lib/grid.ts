/**
 * 吸附与坐标换算。
 * 纯函数，同时被画布交互（缩放后的像素坐标）与测试使用。
 */
import { GRID_SIZE } from '../constants';

/** 将任意米坐标吸附到最近的 0.5 米网格点（四舍五入，避免浮点误差与 -0）。 */
export function snapToGrid(value: number, grid: number = GRID_SIZE): number {
  const v = Math.round(value / grid) * grid;
  return v === 0 ? 0 : v;
}

/** 像素坐标 -> 展厅米坐标，考虑画布缩放与平移。 */
export function screenToWorld(
  px: number,
  py: number,
  scale: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: (px - pan.x) / scale,
    y: (py - pan.y) / scale,
  };
}

/** 展厅米坐标 -> 像素坐标。 */
export function worldToScreen(
  x: number,
  y: number,
  scale: number,
  pan: { x: number; y: number },
): { x: number; y: number } {
  return {
    x: x * scale + pan.x,
    y: y * scale + pan.y,
  };
}

/** 像素位移 -> 米位移（仅受缩放影响，平移在做差时抵消）。 */
export function screenDeltaToWorld(
  dxPx: number,
  dyPx: number,
  scale: number,
): { x: number; y: number } {
  return { x: dxPx / scale, y: dyPx / scale };
}

/**
 * 拖拽时计算吸附后的展位左上角。
 * @param grabOffsetM 抓取点相对展位左上角的偏移（米，拖拽开始时锁定）
 */
export function snapDragPosition(
  pointerWorldX: number,
  pointerWorldY: number,
  grabOffsetM: { x: number; y: number },
  grid: number = GRID_SIZE,
): { x: number; y: number } {
  return {
    x: snapToGrid(pointerWorldX - grabOffsetM.x, grid),
    y: snapToGrid(pointerWorldY - grabOffsetM.y, grid),
  };
}

/** 缩放手柄时计算吸附后的新尺寸（不小于一个网格）。 */
export function snapResize(
  sizeM: number,
  grid: number = GRID_SIZE,
  minSize: number = grid,
): number {
  return Math.max(minSize, snapToGrid(sizeM, grid));
}

/** 米 -> SVG 显示字符串（去掉 0.30000000000000004 之类的浮点尾巴）。 */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
