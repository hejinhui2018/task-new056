/**
 * 展位几何：轴对齐碰撞、1.5 米净空检查、越界、旋转尺寸与正面接待点。
 * 展位始终以轴对齐矩形存储；90° 旋转等价于交换宽高。
 */
import type { Booth, ExitDef, Orientation, Point } from '../types';
import { CLEARANCE, EXITS, HALL_HEIGHT, HALL_WIDTH } from '../constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectOf(b: Booth): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

/** 两个轴对齐矩形是否相交（正面积重叠；仅边重合不算）。 */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

/** 展位是否完全位于展厅内（允许贴墙）。越界时返回越界说明。 */
export function outOfBounds(b: Booth): string | null {
  const problems: string[] = [];
  if (b.x < 0) problems.push(`左侧超出墙面 ${m(-b.x)}`);
  if (b.y < 0) problems.push(`顶部超出墙面 ${m(-b.y)}`);
  if (b.x + b.w > HALL_WIDTH)
    problems.push(`右侧超出墙面 ${m(b.x + b.w - HALL_WIDTH)}`);
  if (b.y + b.h > HALL_HEIGHT)
    problems.push(`底部超出墙面 ${m(b.y + b.h - HALL_HEIGHT)}`);
  return problems.length ? problems.join('；') : null;
}

function m(n: number): string {
  return `${Math.round(n * 100) / 100} m`;
}

/**
 * 净空检查：两个展位之间是否保留 CLEARANCE 米通道。
 * 仅当两矩形在某一轴上的投影重叠（边与边相对）时，检查另一轴的间距；
 * 两个轴都有正间距（纯对角关系）时不判定——斜角之间本就可以通行。
 *
 * 注意：展位贴同一面墙并排时，它们之间同样需要 1.5 m 间隔（按运营规则从严）。
 * 返回实际最小间距（米）与方向；净空不足返回描述。
 */
export function clearanceViolation(
  a: Booth,
  b: Booth,
  clearance: number = CLEARANCE,
): { gap: number; axis: 'x' | 'y' } | null {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const gapX = gapOnAxis(ra, rb, 'x');
  const gapY = gapOnAxis(ra, rb, 'y');
  // 两矩形在 x 轴投影重叠（gap<=0）时，它们上下相对，检查前后（y）间距。
  if (gapX <= 0 && gapY > 0) {
    if (gapY < clearance) return { gap: gapY, axis: 'y' };
    return null;
  }
  // y 轴投影重叠时，它们左右相对，检查左右（x）间距。
  if (gapY <= 0 && gapX > 0) {
    if (gapX < clearance) return { gap: gapX, axis: 'x' };
    return null;
  }
  // 两轴都重叠是 overlap（调用方已先判定）；都不重叠是对角关系，不约束。
  return null;
}

function gapOnAxis(a: Rect, b: Rect, axis: 'x' | 'y'): number {
  const p = axis === 'x' ? 'x' : 'y';
  const s = axis === 'x' ? 'w' : 'h';
  const amin = a[p];
  const amax = a[p] + a[s];
  const bmin = b[p];
  const bmax = b[p] + b[s];
  return Math.max(bmin - amax, amin - bmax);
}

/** 旋转 90°：交换宽高，并让朝向顺时针转 90°。位置保持左上角不变（随后被网格吸附）。 */
export function rotate90(b: Booth): Booth {
  const next: Record<Orientation, Orientation> = {
    north: 'east',
    east: 'south',
    south: 'west',
    west: 'north',
  };
  return {
    ...b,
    w: b.h,
    h: b.w,
    orientation: next[b.orientation],
  };
}

/**
 * 展位正面的接待点：正面边的中点，向外（展位外）0.25 m。
 * 路径搜索从该点出发；该点必须落在通道上。
 */
export function receptionPoint(b: Booth): Point {
  return frontPoint(b, 0.25);
}

/** 正面边中点向外 offset 米处的点（offset=0 即边中点）。 */
export function frontPoint(b: Booth, offset: number): Point {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  switch (b.orientation) {
    case 'north':
      return { x: cx, y: b.y - offset };
    case 'south':
      return { x: cx, y: b.y + b.h + offset };
    case 'west':
      return { x: b.x - offset, y: cy };
    case 'east':
      return { x: b.x + b.w + offset, y: cy };
  }
}

/** 正面边的两个端点（用于在图上画出“正面”标记）。 */
export function frontEdge(b: Booth): [Point, Point] {
  switch (b.orientation) {
    case 'north':
      return [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
      ];
    case 'south':
      return [
        { x: b.x, y: b.y + b.h },
        { x: b.x + b.w, y: b.y + b.h },
      ];
    case 'west':
      return [
        { x: b.x, y: b.y },
        { x: b.x, y: b.y + b.h },
      ];
    case 'east':
      return [
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
      ];
  }
}

/** 出口在寻路网格上的目标点集合（开口内侧 0.25 m、沿开口每 0.5 m 一个点）。 */
export function exitTargetPoints(
  exits: ExitDef[] = EXITS,
  inset: number = 0.25,
  step: number = 0.5,
): Point[] {
  const points: Point[] = [];
  for (const e of exits) {
    const across = e.wall === 'north' || e.wall === 'south' ? 'x' : 'y';
    const fixed =
      e.wall === 'south'
        ? HALL_HEIGHT - inset
        : e.wall === 'north'
          ? inset
          : e.wall === 'east'
            ? HALL_WIDTH - inset
            : inset;
    for (let t = e.start; t <= e.end + 1e-9; t += step) {
      points.push(across === 'x' ? { x: t, y: fixed } : { x: fixed, y: t });
    }
  }
  return points;
}
