/**
 * 统一展位几何：所有结论都从“旋转后的多边形 footprint”生成。
 *
 * 展位以本地轴对齐矩形 (x,y,w,h) + 绕中心顺时针旋转角 rotation（度）存储。
 * 渲染、指针命中、重叠（SAT）、越界（角点包络）、1.5 m 净空（多边形最近距离）
 * 与寻路障碍（网格单元 vs footprint 正面积相交）一律使用 footprint()，
 * 不得再用未旋转的 w/h 外接矩形作最终结论。
 */
import type { Booth, ExitDef, Orientation, Point } from '../types';
import { CLEARANCE, EXITS, HALL_HEIGHT, HALL_WIDTH } from '../constants';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 凸多边形（世界坐标，米）；矩形展位即 4 个角点。 */
export type Polygon = Point[];

const EPS = 1e-9;

/** 本地（未旋转）矩形；仅用于网格单元等天然轴对齐的形状，不用于展位最终判定。 */
export function rectOf(b: Booth): Rect {
  return { x: b.x, y: b.y, w: b.w, h: b.h };
}

export function centerOf(b: Booth): Point {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 点 p 绕 center 顺时针旋转 deg 度。 */
export function rotatePoint(p: Point, center: Point, deg: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(rad(deg));
  const sin = Math.sin(rad(deg));
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

/** rotatePoint 的逆变换。 */
export function unrotatePoint(p: Point, center: Point, deg: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  const cos = Math.cos(rad(deg));
  const sin = Math.sin(rad(deg));
  return {
    x: center.x + dx * cos + dy * sin,
    y: center.y - dx * sin + dy * cos,
  };
}

/** 本地点 -> 世界点（先平移到中心，按 rotation 顺时针旋转，再移回）。 */
export function localToWorld(b: Booth, p: Point): Point {
  return rotatePoint(p, centerOf(b), b.rotation);
}

/** 世界点 -> 本地点（localToWorld 的逆变换，缩放手柄时把指针映回未旋转矩形）。 */
export function worldToLocal(b: Booth, p: Point): Point {
  return unrotatePoint(p, centerOf(b), b.rotation);
}

/**
 * 展位旋转后的实际形状：按 左上、右上、右下、左下 顺序的世界角点。
 * 这是全应用唯一的展位几何事实来源。
 */
export function footprint(b: Booth): Polygon {
  const local: Point[] = [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ];
  return local.map((p) => localToWorld(b, p));
}

/** 旋转后角点的轴对齐包络（仅用于钳制/包络展示，碰撞结论不用它）。 */
export function footprintAABB(b: Booth): Rect {
  const poly = footprint(b);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function edgeAxes(poly: Polygon): Point[] {
  const axes: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b2 = poly[(i + 1) % poly.length];
    const ex = b2.x - a.x;
    const ey = b2.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    // 边的单位法向量
    axes.push({ x: -ey / len, y: ex / len });
  }
  return axes;
}

function project(poly: Polygon, axis: Point): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min, max };
}

/**
 * 两个凸多边形是否具有“正面积”重叠（SAT）。
 * 仅角点相触、边相贴（某条分离轴上穿透深度为 0）不算重叠——允许贴边。
 */
export function polysOverlapPositive(a: Polygon, b: Polygon): boolean {
  const axes = dedupeAxes([...edgeAxes(a), ...edgeAxes(b)]);
  for (const axis of axes) {
    const pa = project(a, axis);
    const pb = project(b, axis);
    const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
    if (overlap <= EPS) return false; // 该轴分离或恰好相触
  }
  return true;
}

function dedupeAxes(axes: Point[]): Point[] {
  const out: Point[] = [];
  for (const ax of axes) {
    const dup = out.some(
      (o) =>
        Math.abs(o.x - ax.x) < 1e-7 && Math.abs(o.y - ax.y) < 1e-7,
    ) ||
      out.some(
        (o) =>
          Math.abs(o.x + ax.x) < 1e-7 && Math.abs(o.y + ax.y) < 1e-7,
      );
    if (!dup) out.push(ax);
  }
  return out;
}

/** 两个轴对齐矩形是否正面积相交（仅边重合不算）；用于网格单元等天然矩形。 */
export function intersects(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS &&
    a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS &&
    a.y + a.h > b.y + EPS
  );
}

/** 两个展位的旋转后形状是否正面积重叠。 */
export function boothsOverlap(a: Booth, b: Booth): boolean {
  return polysOverlapPositive(footprint(a), footprint(b));
}

/** 点是否落在展位旋转后形状内（含边界，供指针命中）。 */
export function boothContainsPoint(b: Booth, p: Point): boolean {
  return pointInPolygon(p, footprint(b));
}

function pointInPolygon(p: Point, poly: Polygon): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const cross = (c.x - a.x) * (p.y - a.y) - (c.y - a.y) * (p.x - a.x);
    if (cross > EPS) {
      if (sign < 0) return false;
      sign = 1;
    } else if (cross < -EPS) {
      if (sign > 0) return false;
      sign = -1;
    }
  }
  return true; // 含边界
}

/**
 * 两个凸多边形的相交多边形（Sutherland–Hodgman），用于绘制真实重叠区域；
 * 不相交（含仅相触）时返回 null。
 */
export function polygonIntersection(a: Polygon, b: Polygon): Polygon | null {
  if (!polysOverlapPositive(a, b)) return null;
  let out: Point[] = a.slice();
  for (let i = 0; i < b.length; i++) {
    if (out.length === 0) return null;
    const edgeA = b[i];
    const edgeB = b[(i + 1) % b.length];
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const cur = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const curIn = insideHalfPlane(cur, edgeA, edgeB);
      const prevIn = insideHalfPlane(prev, edgeA, edgeB);
      if (curIn) {
        if (!prevIn) out.push(lineIntersection(prev, cur, edgeA, edgeB));
        out.push(cur);
      } else if (prevIn) {
        out.push(lineIntersection(prev, cur, edgeA, edgeB));
      }
    }
  }
  return out.length ? out : null;
}

function insideHalfPlane(p: Point, a: Point, b: Point): boolean {
  // b 多边形角点按顺时针（y 向下）排列，内部在边的右侧：cross <= 0
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= EPS;
}

function lineIntersection(p1: Point, p2: Point, a: Point, b: Point): Point {
  const d1x = p2.x - p1.x;
  const d1y = p2.y - p1.y;
  const d2x = b.x - a.x;
  const d2y = b.y - a.y;
  const denom = d1x * d2y - d1y * d2x;
  const t = ((a.x - p1.x) * d2y - (a.y - p1.y) * d2x) / denom;
  return { x: p1.x + t * d1x, y: p1.y + t * d1y };
}

/* ================= 净空：多边形最近距离 ================= */

export interface ClearanceResult {
  /** 两形状之间的真实最小间距（米） */
  gap: number;
  /** 最小间距连线的主导方向（用于“左右/前后”措辞与标注方向） */
  axis: 'x' | 'y';
  /** A 上的最近点 */
  pa: Point;
  /** B 上的最近点 */
  pb: Point;
}

/**
 * 两个展位之间是否保留 clearance 米通道，结论基于旋转后多边形的真实最近距离。
 *
 * 沿用运营语义：
 * - 正面积重叠由调用方先判 overlap，这里不处理；
 * - 最近特征是“角对角”（两个斜角相对、中间本可通行）时不约束；
 * - 边对边（平行）或角对边（斜角逼近另一展位正面）时按真实间距检查。
 */
export function clearanceViolation(
  a: Booth,
  b: Booth,
  clearance: number = CLEARANCE,
): ClearanceResult | null {
  const pa0 = footprint(a);
  const pb0 = footprint(b);
  if (polysOverlapPositive(pa0, pb0)) return null;

  const closest = closestBetweenPolygons(pa0, pb0);
  // 两个最近点都在顶点上 => 纯角对角，斜角之间可通行，不判净空。
  if (closest.aVertex && closest.bVertex) return null;

  const gap = closest.gap;
  if (!(gap < clearance - EPS)) return null;
  const dx = closest.pb.x - closest.pa.x;
  const dy = closest.pb.y - closest.pa.y;
  return {
    gap,
    axis: Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y',
    pa: closest.pa,
    pb: closest.pb,
  };
}

interface ClosestFeatures {
  pa: Point;
  pb: Point;
  gap: number;
  aVertex: boolean;
  bVertex: boolean;
}

function closestBetweenPolygons(
  a: Polygon,
  b: Polygon,
): ClosestFeatures {
  let best: ClosestFeatures | null = null;
  const cornerCorner = (f: ClosestFeatures) => f.aVertex && f.bVertex;
  const consider = (f: ClosestFeatures) => {
    if (!best) {
      best = f;
      return;
    }
    if (f.gap < best.gap - EPS) {
      best = f;
    } else if (Math.abs(f.gap - best.gap) <= EPS && cornerCorner(best) && !cornerCorner(f)) {
      // 等距时优先采用边特征，避免正对的两条边退化成“角对角”而漏判净空。
      best = f;
    }
  };

  for (let i = 0; i < a.length; i++) {
    const sa0 = a[i];
    const sa1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const sb0 = b[j];
      const sb1 = b[(j + 1) % b.length];

      // 平行边（含同向/反向）：若沿边方向的投影区间重叠，最近接触是“边对边”，
      // 取重叠段中点；不能退化成端点对，否则正对的两条边会被误判成角对角。
      const parallel = parallelEdgeContact(sa0, sa1, sb0, sb1);
      if (parallel) {
        consider(parallel);
        continue;
      }
      const seg = closestSegmentSegment(sa0, sa1, sb0, sb1);
      consider({
        pa: seg.pa,
        pb: seg.pb,
        gap: seg.dist,
        aVertex: seg.t <= EPS || seg.t >= 1 - EPS,
        bVertex: seg.u <= EPS || seg.u >= 1 - EPS,
      });
    }
  }
  return best!;
}

/** 两条平行边在沿边方向投影重叠时返回边对边最近特征；否则 null。 */
function parallelEdgeContact(
  p1: Point,
  q1: Point,
  p2: Point,
  q2: Point,
): ClosestFeatures | null {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const l1 = Math.hypot(d1x, d1y);
  if (l1 < EPS) return null;
  const ux = d1x / l1;
  const uy = d1y / l1;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) > 1e-6) return null; // 不平行

  // p2 在 d1 方向直线上的垂足参数（有符号距离 / l1）
  const rx = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const s0 = rx * ux + ry * uy;
  const proj2 = d2x * ux + d2y * uy; // 边2在边1方向上的有符号投影长度
  const lo = Math.max(0, Math.min(s0, s0 + proj2));
  const hi = Math.min(l1, Math.max(s0, s0 + proj2));
  if (hi < lo - EPS) return null; // 投影区间不重叠

  // 取重叠段中点作为最近点；line2 = line1 沿法线平移 d，故 pb = pa + d*n。
  const sMid = (lo + hi) / 2;
  const pa = { x: p1.x + ux * sMid, y: p1.y + uy * sMid };
  const nx = -uy;
  const ny = ux;
  const d = rx * nx + ry * ny; // line2 相对 line1 的有符号法向距离
  const pb = { x: pa.x + nx * d, y: pa.y + ny * d };
  return { pa, pb, gap: Math.abs(d), aVertex: false, bVertex: false };
}

/** 两条线段的最近点对（参数 t/u 同时用于区分“顶点特征/边特征”）。 */
function closestSegmentSegment(
  p1: Point,
  q1: Point,
  p2: Point,
  q2: Point,
): { pa: Point; pb: Point; dist: number; t: number; u: number } {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const r = p2.x - p1.x;
  const ry = p2.y - p1.y;
  const aLen = d1x * d1x + d1y * d1y;
  const bLen = d2x * d2x + d2y * d2y;
  const e = d1x * d2x + d1y * d2y;
  const denom = aLen * bLen - e * e;

  const sN = r * d1x + ry * d1y; // d1·(p2-p1)
  const tN = r * d2x + ry * d2y; // d2·(p2-p1)
  let s = 0;
  let t = 0;

  if (denom > EPS) {
    s = Math.max(0, Math.min(1, (sN * bLen - tN * e) / denom));
  }
  // 由 (e*s - bLen*t) = tN 推 t
  t = (e * s - tN) / bLen;
  if (t < 0) {
    t = 0;
    s = Math.max(0, Math.min(1, sN / aLen));
  } else if (t > 1) {
    t = 1;
    s = Math.max(0, Math.min(1, (sN + e) / aLen));
  }

  const pa = { x: p1.x + s * d1x, y: p1.y + s * d1y };
  const pb = { x: p2.x + t * d2x, y: p2.y + t * d2y };
  return {
    pa,
    pb,
    dist: Math.hypot(pb.x - pa.x, pb.y - pa.y),
    t: s,
    u: t,
  };
}

/**
 * 展位是否完全位于展厅内（允许贴墙）：检查旋转后每个角点。
 * 旋转可能把原本在界内的矩形角甩出墙，越界量按角点包络计算。
 */
export function outOfBounds(b: Booth): string | null {
  const box = footprintAABB(b);
  const problems: string[] = [];
  if (box.x < -EPS) problems.push(`左侧超出墙面 ${m(-box.x)}`);
  if (box.y < -EPS) problems.push(`顶部超出墙面 ${m(-box.y)}`);
  if (box.x + box.w > HALL_WIDTH + EPS)
    problems.push(`右侧超出墙面 ${m(box.x + box.w - HALL_WIDTH)}`);
  if (box.y + box.h > HALL_HEIGHT + EPS)
    problems.push(`底部超出墙面 ${m(box.y + box.h - HALL_HEIGHT)}`);
  return problems.length ? problems.join('；') : null;
}

function m(n: number): string {
  return `${Math.round(n * 100) / 100} m`;
}

/** 旋转 90°：本地宽高保持不变（精确尺寸），绕中心转 90°，朝向顺时针转 90°。 */
export function rotate90(b: Booth): Booth {
  const next: Record<Orientation, Orientation> = {
    north: 'east',
    east: 'south',
    south: 'west',
    west: 'north',
  };
  return {
    ...b,
    rotation: ((b.rotation + 90) % 360 + 360) % 360,
    orientation: next[b.orientation],
  };
}

const ORIENT_DIR: Record<Orientation, Point> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
  east: { x: 1, y: 0 },
};

/**
 * 正面边：旋转后多边形上朝 orientation 方向伸出最远的那条边（其中点）。
 * 0/90/180/270 时它恰为对应世界方向的实体边。
 */
function frontEdgeMidpoint(b: Booth): Point {
  const poly = footprint(b);
  const dir = ORIENT_DIR[b.orientation];
  let best: Point | null = null;
  let bestDot = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const d = mid.x * dir.x + mid.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      best = mid;
    }
  }
  return best!;
}

/**
 * 展位正面的接待点：正面边中点向外（展位外）0.25 m。
 * 路径搜索从该点出发；该点必须落在通道上。
 */
export function receptionPoint(b: Booth): Point {
  return frontPoint(b, 0.25);
}

/** 正面边中点向外 offset 米处的点（offset=0 即边中点）。方向取世界朝向。 */
export function frontPoint(b: Booth, offset: number): Point {
  const mid = frontEdgeMidpoint(b);
  const dir = ORIENT_DIR[b.orientation];
  return { x: mid.x + dir.x * offset, y: mid.y + dir.y * offset };
}

/** 正面边的两个端点（用于在图上画出“正面”标记）：取朝向方向上的实体边。 */
export function frontEdge(b: Booth): [Point, Point] {
  const poly = footprint(b);
  const dir = ORIENT_DIR[b.orientation];
  let bestAi = 0;
  let bestDot = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const c = poly[(i + 1) % poly.length];
    const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
    const d = mid.x * dir.x + mid.y * dir.y;
    if (d > bestDot) {
      bestDot = d;
      bestAi = i;
    }
  }
  return [poly[bestAi], poly[(bestAi + 1) % poly.length]];
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
