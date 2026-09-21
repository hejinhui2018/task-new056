/**
 * 画布交互的纯几何计算：自由旋转手势与旋转状态下的手柄缩放。
 * 抽成纯函数，使“拖动中旋转”“高缩放下缩放”等场景可脱离 DOM 精确测试；
 * FloorPlan 只负责把指针事件换算成世界坐标后调用这里。
 */
import type { Booth, Orientation, Point } from '../types';
import { GRID_SIZE } from '../constants';
import { snapResize, snapToGrid } from './grid';
import { localToWorld, worldToLocal } from './geometry';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const ORIENT_ORDER: Orientation[] = ['north', 'east', 'south', 'west'];

/** 归一化到 [0,360)，并吸附到 snap 度。 */
export function normalizeAngle(deg: number, snap: number = 0.5): number {
  const snapped = Math.round(deg / snap) * snap;
  return ((snapped % 360) + 360) % 360;
}

export interface RotateDragStart {
  rotation: number;
  orientation: Orientation;
  /** 按下时指针相对中心的方位角（弧度） */
  pointerAngle: number;
}

export interface RotateDragResult {
  rotation: number;
  orientation: Orientation;
  /** 指针是否已离开点击阈值（区分“点击旋钮=转 90°”与“拖动自由转”） */
  moved: boolean;
}

/**
 * 拖动旋转旋钮：指针方位角增量累加到起始角度。
 * @param angleSnap 角度吸附（默认 0.5°；按住 Shift 时用 5°）
 * @param moveThreshold 判定为拖动的最小角位移（度）
 */
export function rotationDrag(
  start: RotateDragStart,
  currentPointerAngle: number,
  angleSnap: number = 0.5,
  moveThreshold: number = 2,
): RotateDragResult {
  let deltaDeg = ((currentPointerAngle - start.pointerAngle) * 180) / Math.PI;
  // 处理跨过 ±180° 的回绕，保证累计转动量连续
  if (deltaDeg > 180) deltaDeg -= 360;
  if (deltaDeg < -180) deltaDeg += 360;
  const moved = Math.abs(deltaDeg) > moveThreshold;
  const rotation = normalizeAngle(start.rotation + deltaDeg, angleSnap);
  const quarters = Math.round(deltaDeg / 90);
  const baseIdx = ORIENT_ORDER.indexOf(start.orientation);
  const orientation = ORIENT_ORDER[((baseIdx + quarters) % 4 + 4) % 4];
  return { rotation, orientation, moved };
}

interface ResizeStart {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
}

/**
 * 旋转状态下拖手柄缩放：
 * 1) 把世界指针映回会话起始矩形的本地（未旋转）坐标；
 * 2) 按手柄在本地系内吸附改尺寸；
 * 3) 反解中心，使“非拖拽侧”锚点在世界坐标中保持不动（旋转后缩放不漂移）。
 */
export function computeResize(
  start: ResizeStart,
  handle: HandleId,
  worldPointer: Point,
  grid: number = GRID_SIZE,
): Partial<Booth> {
  const ref: Booth = {
    id: '',
    x: start.x,
    y: start.y,
    w: start.w,
    h: start.h,
    rotation: start.rotation,
    orientation: 'south',
    label: '',
    color: '',
  };
  const local = worldToLocal(ref, worldPointer);
  const px = snapToGrid(local.x, grid);
  const py = snapToGrid(local.y, grid);
  let { x, y, w, h } = start;
  const min = grid;

  if (handle.includes('e')) w = snapResize(px - start.x, grid, min);
  if (handle.includes('w')) {
    const left = Math.min(px, start.x + start.w - min);
    w = snapResize(start.x + start.w - left, grid, min);
    x = snapToGrid(start.x + start.w - w, grid);
  }
  if (handle.includes('s')) h = snapResize(py - start.y, grid, min);
  if (handle.includes('n')) {
    const top = Math.min(py, start.y + start.h - min);
    h = snapResize(start.y + start.h - top, grid, min);
    y = snapToGrid(start.y + start.h - h, grid);
  }

  const anchorLocal = (rx: number, ry: number, rw: number, rh: number): Point => ({
    x: handle.includes('e')
      ? rx
      : handle.includes('w')
        ? rx + rw
        : rx + rw / 2,
    y: handle.includes('s')
      ? ry
      : handle.includes('n')
        ? ry + rh
        : ry + rh / 2,
  });

  const anchorWorld = localToWorld(
    ref,
    anchorLocal(start.x, start.y, start.w, start.h),
  );
  const newCenter = { x: x + w / 2, y: y + h / 2 };
  const anchorInNew = anchorLocal(x, y, w, h);
  // 锚点相对新中心的本地向量旋转到世界；中心 = 锚点世界位置 - 该向量。
  const r = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const vx = anchorInNew.x - newCenter.x;
  const vy = anchorInNew.y - newCenter.y;
  const rotated = { x: vx * cos - vy * sin, y: vx * sin + vy * cos };
  const center = { x: anchorWorld.x - rotated.x, y: anchorWorld.y - rotated.y };
  return { x: center.x - w / 2, y: center.y - h / 2, w, h };
}
