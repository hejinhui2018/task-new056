/**
 * 吸附与坐标换算。
 * 纯函数，同时被画布交互（缩放后的像素坐标）与测试使用。
 */
import { GRID_SIZE } from '../constants';
import { rotateVector } from './geometry';
import type { Point } from '../types';

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

/**
 * 拖动时计算吸附后的展位【锚点】。
 * 抓取点在展位局部系内锁定（drag 开始时记录），这里用展位当前角度把它
 * 旋到世界系再从指针位置扣除——因此“拖动中旋转”（角度在会话间变化）后，
 * 仍精确抓在同一点，不会跳到外接 AABB 角点。
 */
export function dragAnchor(
  pointerWorld: Point,
  grabLocal: Point,
  rotation: number,
  grid: number = GRID_SIZE,
): Point {
  const off = rotateVector(rotation, grabLocal);
  return {
    x: snapToGrid(pointerWorld.x - off.x, grid),
    y: snapToGrid(pointerWorld.y - off.y, grid),
  };
}

/**
 * 缩放手柄：在展位【局部（未旋转）坐标系】内计算新原点位置与尺寸。
 * 返回的 ox/oy 是新局部原点相对于缩放开始时旧原点的局部位移，
 * w/h 为新的未旋转尺寸（均吸附网格、不小于 minSize）。
 * 调用方把 (ox,oy) 按展位当前角度旋转后加到世界锚点上，
 * 从而旋转展位缩放时锚点不会错位。
 */
export function resizeLocal(
  startW: number,
  startH: number,
  handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
  localX: number,
  localY: number,
  grid: number = GRID_SIZE,
  minSize: number = grid,
): { ox: number; oy: number; w: number; h: number } {
  const px = snapToGrid(localX, grid);
  const py = snapToGrid(localY, grid);
  let ox = 0;
  let oy = 0;
  let w = startW;
  let h = startH;
  if (handle.includes('e')) {
    w = Math.max(minSize, snapToGrid(px, grid));
  }
  if (handle.includes('w')) {
    const left = Math.min(px, startW - minSize);
    w = Math.max(minSize, snapToGrid(startW - left, grid));
    ox = snapToGrid(startW - w, grid);
  }
  if (handle.includes('s')) {
    h = Math.max(minSize, snapToGrid(py, grid));
  }
  if (handle.includes('n')) {
    const top = Math.min(py, startH - minSize);
    h = Math.max(minSize, snapToGrid(startH - top, grid));
    oy = snapToGrid(startH - h, grid);
  }
  return { ox, oy, w, h };
}

/** 米 -> SVG 显示字符串（去掉 0.30000000000000004 之类的浮点尾巴）。 */
export function fmt(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}
