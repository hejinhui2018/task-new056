import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { EXITS, HALL_HEIGHT, HALL_WIDTH, PATH_GRID } from '../constants';
import {
  exitBlockingBooth,
  findExitPath,
  isBlockedCell,
} from './pathfinding';
import { exitTargetPoints, receptionPoint } from './geometry';

function booth(p: Partial<Booth> & Pick<Partial<Booth>, never>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 2,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

describe('findExitPath 疏散寻路', () => {
  it('空展厅：任意接待点可达出口，路径起点正确', () => {
    const b = booth({ x: 9, y: 6, w: 2, h: 2, orientation: 'south' });
    const start = receptionPoint(b);
    const r = findExitPath([b], start);
    expect(r.reachable).toBe(true);
    expect(r.path.length).toBeGreaterThan(1);
    expect(r.path[0]).toEqual(start);
  });

  it('路径终点落在某个出口开口内侧', () => {
    const b = booth({ x: 9, y: 6 });
    const r = findExitPath([b], receptionPoint(b));
    const end = r.path[r.path.length - 1];
    const targets = exitTargetPoints(EXITS);
    const close = targets.some(
      (t) => Math.abs(t.x - end.x) <= PATH_GRID && Math.abs(t.y - end.y) <= PATH_GRID,
    );
    expect(close).toBe(true);
  });

  it('路径每一步都在展厅内、4 邻接且不穿越展位', () => {
    const obstacle = booth({ id: 'o', x: 5, y: 4, w: 3, h: 5 });
    const b = booth({ id: 's', x: 1, y: 1, orientation: 'east' });
    const r = findExitPath([obstacle, b], receptionPoint(b));
    expect(r.reachable).toBe(true);

    const cols = Math.round(HALL_WIDTH / PATH_GRID);
    const rows = Math.round(HALL_HEIGHT / PATH_GRID);
    // path[0] 是真实接待点（不必在格心），从第 2 个点开始检验格间 4 邻接
    for (let i = 1; i < r.path.length; i++) {
      const p = r.path[i];
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(HALL_WIDTH);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(HALL_HEIGHT);
      // 单元中心对齐 0.5m 网格
      expect((p.x - PATH_GRID / 2) % PATH_GRID).toBeCloseTo(0, 6);
      expect((p.y - PATH_GRID / 2) % PATH_GRID).toBeCloseTo(0, 6);
      // 不落在障碍单元
      const cx = Math.round((p.x - PATH_GRID / 2) / PATH_GRID);
      const cy = Math.round((p.y - PATH_GRID / 2) / PATH_GRID);
      expect(isBlockedCell(cx, cy, [obstacle], cols, rows)).toBe(false);
      if (i >= 2) {
        // 相邻格心恰好在一个方向移动一格（4 邻接）
        const prev = r.path[i - 1];
        const manhattan =
          Math.abs(p.x - prev.x) / PATH_GRID +
          Math.abs(p.y - prev.y) / PATH_GRID;
        expect(Math.round(manhattan)).toBe(1);
      }
    }
  });

  it('四面围挡封闭：区内接待点不可达任一出口', () => {
    // 封闭区 [3,7.5] × [3,7.5]，墙厚 0.5，与网格对齐
    const walls: Booth[] = [
      booth({ id: 'wn', x: 3, y: 3, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 3, y: 7, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ww', x: 3, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
      booth({ id: 'we', x: 7, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([...walls, inside], receptionPoint(inside));
    expect(r.reachable).toBe(false);
    expect(r.path).toEqual([]);
  });

  it('围挡打开一个 1m 缺口后立即可达（必须从缺口绕行）', () => {
    const walls: Booth[] = [
      booth({ id: 'wn', x: 3, y: 3, w: 4.5, h: 0.5, kind: 'partition' }),
      booth({ id: 'ws', x: 3, y: 7, w: 4.5, h: 0.5, kind: 'partition' }),
      // 西墙只盖一半，在 y 5.5..7.5 留缺口
      booth({ id: 'ww', x: 3, y: 3, w: 0.5, h: 2.5, kind: 'partition' }),
      booth({ id: 'we', x: 7, y: 3, w: 0.5, h: 4.5, kind: 'partition' }),
    ];
    const inside = booth({ id: 'in', x: 4.5, y: 4.5, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([...walls, inside], receptionPoint(inside));
    expect(r.reachable).toBe(true);
    // 路径必须经过 x≈3.5 的缺口列（y 在 5.5~7 之间）
    const throughGap = r.path.some(
      (p) => Math.abs(p.x - 3.75) < PATH_GRID && p.y >= 5.5 && p.y <= 7,
    );
    expect(throughGap).toBe(true);
  });

  it('隔断只在右端留 1m 缺口、且南出口被封时，必须绕缺口去北出口', () => {
    // 横贯展厅的隔断，只在最右端 x19..20 留 1m 通道
    const wall = booth({ id: 'wall', x: 0, y: 6.5, w: 19, h: 1, kind: 'partition' });
    // 南出口同时被封住（盖住开口 x3..5 并覆盖边界目标格）
    const southBlocker = booth({ id: 'sb', x: 2.5, y: 12, w: 3, h: 2 });
    const b = booth({ id: 's', x: 9, y: 9, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([wall, southBlocker, b], receptionPoint(b));
    expect(r.reachable).toBe(true);
    // 路径不能穿越隔断实体（y∈(6.5,7.5) 且 x<19）；缺口列 x≥19 内通过是合法的
    const crossing = r.path.filter((p) => p.y > 6.5 && p.y < 7.5 && p.x < 19);
    expect(crossing.length).toBe(0);
    // 必须绕到右端缺口（墙止于 x=19，缺口内格心 19.25）
    expect(r.path.some((p) => p.x >= 19)).toBe(true);
    // 终点在北出口
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
    expect(end.x).toBeGreaterThanOrEqual(14);
    expect(end.x).toBeLessThanOrEqual(16.5);
  });
});

describe('exitBlockingBooth 出口封堵识别', () => {
  it('展位压住南出口开口时识别为封堵展位', () => {
    const blocker = booth({ id: 'blk', x: 2.5, y: 12, w: 3, h: 2 });
    const south = EXITS.find((e) => e.wall === 'south')!;
    const north = EXITS.find((e) => e.wall === 'north')!;
    expect(exitBlockingBooth([blocker], south)?.id).toBe('blk');
    expect(exitBlockingBooth([blocker], north)).toBeNull();
  });

  it('展位只贴墙但不盖开口不算封堵', () => {
    const beside = booth({ x: 6, y: 12.5, w: 2, h: 1.5 }); // 在南出口 x3..5 旁边
    const south = EXITS.find((e) => e.wall === 'south')!;
    expect(exitBlockingBooth([beside], south)).toBeNull();
  });

  it('南出口被封时，展位仍可通过北出口疏散', () => {
    const blocker = booth({ id: 'blk', x: 2.5, y: 12, w: 3, h: 2 });
    const b = booth({ id: 's', x: 1, y: 1, w: 2, h: 2, orientation: 'south' });
    const r = findExitPath([blocker, b], receptionPoint(b));
    expect(r.reachable).toBe(true);
    // 终点应在北墙附近而不是南墙
    const end = r.path[r.path.length - 1];
    expect(end.y).toBeLessThan(1);
  });
});
