/**
 * 疏散可达性：在展厅 0.5 m 网格上做 BFS。
 * 展位 footprint 为障碍（边相不算阻挡，允许贴边通行），
 * 从展位正面接待点出发，4 邻接（不斜穿对角），到达任一出口目标点即成功。
 */
import type { Booth, ExitDef, Point } from '../types';
import {
  EXITS,
  HALL_HEIGHT,
  HALL_WIDTH,
  PATH_GRID,
} from '../constants';
import {
  exitTargetPoints,
  footprint,
  polygonsOverlap,
  polygonAABB,
  rectPolygon,
} from './geometry';
import type { Rect } from './geometry';

export interface PathResult {
  reachable: boolean;
  /** 可走路径（米坐标）；不可达时为空数组 */
  path: Point[];
  /** 调试/测试用：本次搜索的障碍信息 */
  blockedCellCount: number;
}

const EPS = 1e-9;

/** 出口开口内侧网格是否全部可通行；任一目标格被展位占据即视为出口被堵。 */
export function exitBlockingBooth(
  booths: Booth[],
  exitDef: ExitDef,
  g: number = PATH_GRID,
): Booth | null {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  const polys = booths.map((b) => footprint(b));
  for (const t of exitTargetPoints([exitDef])) {
    const c = nearestCell(t, g);
    if (isBlockedCell(c.cx, c.cy, booths, cols, rows, g, polys)) {
      const cell = cellRect(c.cx, c.cy, g);
      const cellPoly = rectPolygon(cell);
      const idx = polys.findIndex((p) => polygonsOverlap(cellPoly, p));
      if (idx >= 0) return booths[idx];
    }
  }
  return null;
}

function cellRect(cx: number, cy: number, g: number): Rect {
  return { x: cx * g, y: cy * g, w: g, h: g };
}

/** AABB 粗筛：外接框不相交则多边形必不相交（仅加速，结论仍以 SAT 为准）。 */
function aabbOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w - EPS &&
    a.x + a.w > b.x + EPS &&
    a.y < b.y + b.h - EPS &&
    a.y + a.h > b.y + EPS
  );
}

/**
 * 判断某个网格单元是否被展位占据：单元矩形与展位【旋转后】多边形做 SAT 判定，
 * 仅边重合（可贴边通行）不算阻挡。与渲染/碰撞/净空使用同一个 footprint。
 * 导出供测试使用。
 */
export function isBlockedCell(
  cx: number,
  cy: number,
  booths: Booth[],
  cols: number,
  rows: number,
  g: number = PATH_GRID,
  polys?: Point[][],
): boolean {
  if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return true;
  const cellPoly = rectPolygon(cellRect(cx, cy, g));
  const cellBox = cellRect(cx, cy, g);
  for (let i = 0; i < booths.length; i++) {
    const poly = polys?.[i] ?? footprint(booths[i]);
    if (!aabbOverlap(cellBox, polygonAABB(poly))) continue;
    if (polygonsOverlap(cellPoly, poly)) return true;
  }
  return false;
}

function nearestCell(p: Point, g: number): { cx: number; cy: number } {
  return {
    cx: Math.round((p.x - g / 2) / g),
    cy: Math.round((p.y - g / 2) / g),
  };
}

/**
 * 从 start 寻路到任一出口。
 * @param booths 当前全部展位（障碍，按旋转后多边形栅格化）
 * @param start 起点（通常是展位接待点）
 */
export function findExitPath(
  booths: Booth[],
  start: Point,
  exits = EXITS,
  g: number = PATH_GRID,
): PathResult {
  const cols = Math.round(HALL_WIDTH / g);
  const rows = Math.round(HALL_HEIGHT / g);
  // 每个展位的旋转后多边形只计算一次，所有网格判定共用。
  const polys = booths.map((b) => footprint(b));

  // 预计算障碍位图（展位越界部分自然落在网格外，不影响室内单元）。
  const blocked = new Uint8Array(cols * rows);
  let blockedCellCount = 0;
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (isBlockedCell(cx, cy, booths, cols, rows, g, polys)) {
        blocked[cy * cols + cx] = 1;
        blockedCellCount++;
      }
    }
  }

  const s = nearestCell(start, g);
  // 起点被堵（例如正面紧贴另一展位）时，先尝试在 2 格范围内找最近的可行走单元。
  let startCell = s;
  if (blocked[s.cy * cols + s.cx]) {
    const alt = nearestFreeNeighbor(s.cx, s.cy, blocked, cols, rows);
    if (!alt) {
      return { reachable: false, path: [], blockedCellCount };
    }
    startCell = alt;
  }

  const targets = new Set<number>();
  for (const t of exitTargetPoints(exits)) {
    const c = nearestCell(t, g);
    if (c.cx >= 0 && c.cx < cols && c.cy >= 0 && c.cy < rows) {
      targets.add(c.cy * cols + c.cx);
    }
  }

  // BFS
  const prev = new Int32Array(cols * rows).fill(-1);
  const seen = new Uint8Array(cols * rows);
  const queue: number[] = [];
  const startIdx = startCell.cy * cols + startCell.cx;
  seen[startIdx] = 1;
  queue.push(startIdx);

  const NEIGHBORS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  let goalIdx = -1;
  while (queue.length) {
    const idx = queue.shift()!;
    if (targets.has(idx)) {
      goalIdx = idx;
      break;
    }
    const cx = idx % cols;
    const cy = Math.floor(idx / cols);
    for (const [dx, dy] of NEIGHBORS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (seen[nIdx] || blocked[nIdx]) continue;
      seen[nIdx] = 1;
      prev[nIdx] = idx;
      queue.push(nIdx);
    }
  }

  if (goalIdx === -1) {
    return { reachable: false, path: [], blockedCellCount };
  }

  // 回溯路径并转为米坐标（单元中心）。
  const cells: number[] = [];
  let cur = goalIdx;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === startIdx) break;
    cur = prev[cur];
  }
  cells.reverse();
  const path: Point[] = cells.map((idx) => ({
    x: (idx % cols) * g + g / 2,
    y: Math.floor(idx / cols) * g + g / 2,
  }));
  // 首点用真实接待点，路径从展位正面出发而不是格子中心。
  path[0] = start;

  return { reachable: true, path, blockedCellCount };
}

function nearestFreeNeighbor(
  cx: number,
  cy: number,
  blocked: Uint8Array,
  cols: number,
  rows: number,
): { cx: number; cy: number } | null {
  for (let r = 1; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!blocked[ny * cols + nx]) return { cx: nx, cy: ny };
      }
    }
  }
  return null;
}
