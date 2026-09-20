/**
 * 展位几何的唯一真相来源。
 *
 * 展位是可旋转矩形：x/y 是旋转锚点（未旋转时的左上角）的世界坐标，
 * w/h 始终是【未旋转】的局部宽高，rotation 是绕锚点顺时针旋转的弧度。
 *
 * 渲染、指针命中、重叠判定、越界、1.5 m 净空与寻路障碍一律使用
 * {@link footprint} 产生的同一个旋转后多边形；任何调用方都不得再拿
 * 未旋转宽高或其粗略外接 AABB 作为最终结论（AABB 仅可用于预筛）。
 */
import type { Booth, ExitDef, Orientation, Point } from '../types';
import { CLEARANCE, EXITS, HALL_HEIGHT, HALL_WIDTH } from '../constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EPS = 1e-9;
const TWO_PI = Math.PI * 2;

/** 把任意角度归一化到 [0, 2π)，消除浮点尾巴（2π 回到 0）。 */
export function normalizeAngle(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/* ------------------------------------------------------------------ */
/* 坐标变换与 footprint                                                 */
/* ------------------------------------------------------------------ */

/** 把向量绕原点顺时针旋转 rotation 弧度（不含平移）。 */
export function rotateVector(rotation: number, p: Point): Point {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  return { x: c * p.x - s * p.y, y: s * p.x + c * p.y };
}

/** 展位局部坐标（未旋转矩形，左上=(0,0)、右下=(w,h)）-> 展厅世界坐标。 */
export function localToWorld(
  b: Pick<Booth, 'x' | 'y' | 'rotation'>,
  lx: number,
  ly: number,
): Point {
  const r = rotateVector(b.rotation, { x: lx, y: ly });
  return { x: b.x + r.x, y: b.y + r.y };
}

/** 世界坐标 -> 展位局部坐标（localToWorld 的逆变换）。 */
export function worldToLocal(
  b: Pick<Booth, 'x' | 'y' | 'rotation'>,
  p: Point,
): Point {
  return rotateVector(-b.rotation, { x: p.x - b.x, y: p.y - b.y });
}

/**
 * 展位旋转后的四个世界角点（闭合顺序：左上、右上、右下、左下）。
 * 这是所有几何结论的统一来源。
 */
export function footprint(b: Booth): Point[] {
  return [
    localToWorld(b, 0, 0),
    localToWorld(b, b.w, 0),
    localToWorld(b, b.w, b.h),
    localToWorld(b, 0, b.h),
  ];
}

/** 轴对齐矩形转四点多边形（网格单元等复用同一套多边形算法）。 */
export function rectPolygon(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** 多边形的轴对齐外接矩形（仅用于粗筛/钳制，不作碰撞结论）。 */
export function polygonAABB(poly: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/* ------------------------------------------------------------------ */
/* 命中                                                                */
/* ------------------------------------------------------------------ */

/** 世界点是否落在展位旋转后矩形内（含边界）；pad 为向外扩展的命中容差（米）。 */
export function pointInBooth(b: Booth, p: Point, pad = 0): boolean {
  const l = worldToLocal(b, p);
  return (
    l.x >= -EPS - pad &&
    l.x <= b.w + EPS + pad &&
    l.y >= -EPS - pad &&
    l.y <= b.h + EPS + pad
  );
}

/* ------------------------------------------------------------------ */
/* 重叠（正面积相交；仅边/点接触不算）                                    */
/* ------------------------------------------------------------------ */

function edges(poly: Point[]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (let i = 0; i < poly.length; i++) {
    out.push([poly[i], poly[(i + 1) % poly.length]]);
  }
  return out;
}

/** SAT 投影：返回多边形在轴上的 [min,max]。 */
function project(poly: Point[], ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * ax + p.y * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * 两个凸多边形是否有【正面积】重叠（分离轴定理）。
 * 仅边重合或角点接触（某轴穿透量为 0）时返回 false——与轴对齐时代
 * “可贴边”的规则一致，旋转后也成立。
 */
export function polygonsOverlap(a: Point[], b: Point[]): boolean {
  const checked = new Set<string>();
  for (const poly of [a, b]) {
    for (const [p, q] of edges(poly)) {
      // 边的法向量
      let ax = -(q.y - p.y);
      let ay = q.x - p.x;
      const len = Math.hypot(ax, ay);
      if (len < EPS) continue;
      ax /= len;
      ay /= len;
      const key = `${Math.round(ax * 1e10)}:${Math.round(ay * 1e10)}`;
      const key2 = `${Math.round(-ax * 1e10)}:${Math.round(-ay * 1e10)}`;
      if (checked.has(key) || checked.has(key2)) continue;
      checked.add(key);
      const [aMin, aMax] = project(a, ax, ay);
      const [bMin, bMax] = project(b, ax, ay);
      const penetration = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      // 任一分离轴上没有正穿透即不相交（接触 = 穿透 0，不算）。
      if (penetration <= EPS) return false;
    }
  }
  return true;
}

/** 两个展位的旋转后多边形是否正面积重叠。 */
export function boothsOverlap(a: Booth, b: Booth): boolean {
  return polygonsOverlap(footprint(a), footprint(b));
}

/**
 * 两个凸多边形的实际相交区域（Sutherland–Hodgman 多边形裁剪）。
 * 仅边/点接触（零面积）时返回 null。供画面红斜纹使用，与碰撞结论同源。
 */
export function intersectionPolygon(a: Point[], b: Point[]): Point[] | null {
  let out = a.slice();
  const clipEdges = edges(b);
  for (const [e0, e1] of clipEdges) {
    if (out.length === 0) return null;
    const input = out;
    out = [];
    // b 的边内法向：边方向 (e1-e0)，左侧法向指向多边形内部（顶点按固定绕序）。
    const nx = -(e1.y - e0.y);
    const ny = e1.x - e0.x;
    const inside = (p: Point) => nx * (p.x - e0.x) + ny * (p.y - e0.y) >= -EPS;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur);
      const prevIn = inside(prev);
      if (curIn) {
        if (!prevIn) out.push(lineCross(prev, cur, e0, nx, ny));
        out.push(cur);
      } else if (prevIn) {
        out.push(lineCross(prev, cur, e0, nx, ny));
      }
    }
  }
  if (out.length < 3) return null;
  // 零面积（压扁成线/点）也判为无重叠区域。
  let area2 = 0;
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const q = out[(i + 1) % out.length];
    area2 += p.x * q.y - q.x * p.y;
  }
  return Math.abs(area2) > EPS ? out : null;
}

/** 线段 prev->cur 与裁剪边所在直线（过 e0、法向 (nx,ny)）的交点。 */
function lineCross(
  prev: Point,
  cur: Point,
  e0: Point,
  nx: number,
  ny: number,
): Point {
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  const denom = nx * dx + ny * dy;
  const t = (nx * (e0.x - prev.x) + ny * (e0.y - prev.y)) / denom;
  return { x: prev.x + t * dx, y: prev.y + t * dy };
}

/* ------------------------------------------------------------------ */
/* 越界                                                                */
/* ------------------------------------------------------------------ */

function m(n: number): string {
  return `${Math.round(n * 100) / 100} m`;
}

/** 展位旋转后多边形是否完全位于展厅内（允许贴墙）。越界时返回说明。 */
export function outOfBounds(b: Booth): string | null {
  const box = polygonAABB(footprint(b));
  const problems: string[] = [];
  if (box.x < -EPS) problems.push(`左侧超出墙面 ${m(-box.x)}`);
  if (box.y < -EPS) problems.push(`顶部超出墙面 ${m(-box.y)}`);
  if (box.x + box.w > HALL_WIDTH + EPS)
    problems.push(`右侧超出墙面 ${m(box.x + box.w - HALL_WIDTH)}`);
  if (box.y + box.h > HALL_HEIGHT + EPS)
    problems.push(`底部超出墙面 ${m(box.y + box.h - HALL_HEIGHT)}`);
  return problems.length ? problems.join('；') : null;
}

/**
 * 给定未旋转宽高与旋转角，旋转后外接框相对锚点的偏移范围。
 * 用于拖动钳制：保证旋转后的多边形整体留在允许区域内。
 */
export function rotatedBoxOffsets(
  w: number,
  h: number,
  rotation: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  // 局部四角 (0,0)(w,0)(w,h)(0,h) 旋转后（相对锚点）的坐标范围。
  const xs = [0, c * w, c * w - s * h, -s * h];
  const ys = [0, s * w, s * w + c * h, c * h];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/** 把锚点 (x,y) 钳制到使旋转后多边形落在 [lo,hi] 矩形内的范围。 */
export function clampAnchor(
  x: number,
  y: number,
  w: number,
  h: number,
  rotation: number,
  loX: number,
  loY: number,
  hiX: number,
  hiY: number,
): { x: number; y: number } {
  const o = rotatedBoxOffsets(w, h, rotation);
  return {
    x: Math.min(hiX - o.maxX, Math.max(loX - o.minX, x)),
    y: Math.min(hiY - o.maxY, Math.max(loY - o.minY, y)),
  };
}

/* ------------------------------------------------------------------ */
/* 净空：两个不重叠凸多边形之间的真实最近距离（最近特征对）               */
/* ------------------------------------------------------------------ */

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < EPS) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export interface ClearanceResult {
  /** 旋转后多边形之间的最小直线间距（米） */
  gap: number;
  /** 间距方向（用于文案：沿世界 x 还是 y 为主） */
  axis: 'x' | 'y';
  /** 最近点对，供画面尺寸标注（同源） */
  p1: Point;
  p2: Point;
}

/**
 * 两个不重叠展位之间的最小间距与最近点对。
 * 穷举“顶点-边”特征对（端点退化即覆盖顶点-顶点），凸多边形间精确。
 * 调用方需先用 {@link boothsOverlap} 排除重叠。
 */
export function polygonGap(a: Point[], b: Point[]): Omit<ClearanceResult, 'axis'> {
  let best = Infinity;
  let bp1: Point = a[0];
  let bp2: Point = b[0];
  const consider = (p: Point, q: Point) => {
    const d = Math.hypot(p.x - q.x, p.y - q.y);
    if (d < best) {
      best = d;
      bp1 = p;
      bp2 = q;
    }
  };
  for (const [e0, e1] of edges(a)) {
    for (const v of b) {
      consider(v, closestOnSegment(v, e0, e1));
    }
  }
  for (const [e0, e1] of edges(b)) {
    for (const v of a) {
      consider(v, closestOnSegment(v, e0, e1));
    }
  }
  return { gap: best, p1: bp1, p2: bp2 };
}

/**
 * 净空检查：两个展位旋转后多边形之间是否保留 clearance 米通道。
 * 距离取真实最近特征间距（边对边、角对边、角对角同一算法），
 * 与渲染、碰撞、寻路使用同一个 footprint。
 * 仅边/角刚好接触（间距 0）时不判净空——与 polygonsOverlap（接触不算重叠）
 * 及寻路栅格（贴边可通行）保持同一规则；只有正间距小于净宽才提示。
 */
export function clearanceViolation(
  a: Booth,
  b: Booth,
  clearance: number = CLEARANCE,
): ClearanceResult | null {
  if (boothsOverlap(a, b)) return null; // 重叠由调用方按 overlap 处理
  const { gap, p1, p2 } = polygonGap(footprint(a), footprint(b));
  if (gap <= EPS || gap >= clearance - EPS) return null;
  return {
    gap,
    p1,
    p2,
    axis: Math.abs(p2.x - p1.x) >= Math.abs(p2.y - p1.y) ? 'x' : 'y',
  };
}

/* ------------------------------------------------------------------ */
/* 旋转                                                                */
/* ------------------------------------------------------------------ */

const ORIENT_ORDER: Orientation[] = ['north', 'east', 'south', 'west'];

/**
 * 顺时针旋转 90°：保持旋转后【外接框左上角】位置不变（与“交换宽高”时代
 * 的落点一致，展位不会因旋转被甩到墙另一侧），w/h 保持未旋转原值，
 * 转向完全由 rotation 表达。orientation 是局部正面方向、随整体一起转，故不变；
 * 世界里的正面/接待点仍会顺时针转 90°（见 {@link worldOrientation}）。
 */
export function rotate90(b: Booth): Booth {
  const rotation = normalizeAngle(b.rotation + Math.PI / 2);
  // 旋转前外接框左上角（四向旋转下始终是固定的同一个世界点）。
  const before = polygonAABB(footprint(b));
  const o = rotatedBoxOffsets(b.w, b.h, rotation);
  return {
    ...b,
    rotation,
    x: snapScaled(before.x - o.minX),
    y: snapScaled(before.y - o.minY),
  };
}

/** 吸附到 0.5 m，避免链式旋转累计浮点尾巴（几何模块内自用，避免与 grid 循环依赖）。 */
function snapScaled(v: number): number {
  const r = Math.round(v / 0.5) * 0.5;
  return r === 0 ? 0 : r;
}

/** 展位当前在【世界系】里的正面朝向（局部朝向叠加旋转，吸附到四方向）。 */
export function worldOrientation(b: Pick<Booth, 'orientation' | 'rotation'>): Orientation {
  const base = ORIENT_ORDER.indexOf(b.orientation);
  const quarter = Math.round(normalizeAngle(b.rotation) / (Math.PI / 2));
  return ORIENT_ORDER[((base + quarter) % 4 + 4) % 4];
}

/** 返回一个把【世界系正面朝向】设为 world 的展位副本（反解出局部朝向）。 */
export function withWorldOrientation(b: Booth, world: Orientation): Booth {
  const worldIdx = ORIENT_ORDER.indexOf(world);
  const quarter = Math.round(normalizeAngle(b.rotation) / (Math.PI / 2));
  const localIdx = ((worldIdx - quarter) % 4 + 4) % 4;
  return { ...b, orientation: ORIENT_ORDER[localIdx] };
}

/* ------------------------------------------------------------------ */
/* 正面 / 接待点（以世界角点表达，随旋转一起转）                          */
/* ------------------------------------------------------------------ */

/** 各朝向对应的局部正面边端点与朝外方向（未旋转局部坐标）。 */
function localFront(
  b: Booth,
): [ [number, number], [number, number], number, number ] {
  switch (b.orientation) {
    case 'north':
      return [[0, 0], [b.w, 0], 0, -1];
    case 'south':
      return [[0, b.h], [b.w, b.h], 0, 1];
    case 'west':
      return [[0, 0], [0, b.h], -1, 0];
    case 'east':
      return [[b.w, 0], [b.w, b.h], 1, 0];
  }
}

/** 正面边的两个局部端点（未旋转局部坐标）。 */
export function frontEdgeLocal(b: Booth): [Point, Point] {
  const [a0, a1] = localFront(b);
  return [{ x: a0[0], y: a0[1] }, { x: a1[0], y: a1[1] }];
}

/** 正面边的两个世界端点（用于在图上画出“正面”标记）。 */
export function frontEdge(b: Booth): [Point, Point] {
  const [p1, p2] = frontEdgeLocal(b);
  return [localToWorld(b, p1.x, p1.y), localToWorld(b, p2.x, p2.y)];
}

/** 正面边中点向外 offset 米处的局部坐标（offset=0 即边中点；未旋转局部系）。 */
export function frontPointLocal(b: Booth, offset: number): Point {
  const [[ax, ay], [cx, cy], nx, ny] = localFront(b);
  return { x: (ax + cx) / 2 + nx * offset, y: (ay + cy) / 2 + ny * offset };
}

/** 正面边中点向外 offset 米处的世界点（offset=0 即边中点）。 */
export function frontPoint(b: Booth, offset: number): Point {
  const p = frontPointLocal(b, offset);
  return localToWorld(b, p.x, p.y);
}

/**
 * 展位正面的接待点：正面边的中点，向外（展位外）0.25 m。
 * 路径搜索从该点出发；该点必须落在通道上。
 */
export function receptionPoint(b: Booth): Point {
  return frontPoint(b, 0.25);
}

/* ------------------------------------------------------------------ */
/* 出口目标点                                                           */
/* ------------------------------------------------------------------ */

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
