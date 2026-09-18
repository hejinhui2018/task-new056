import { describe, it, expect } from 'vitest';
import {
  screenDeltaToWorld,
  screenToWorld,
  snapDragPosition,
  snapResize,
  snapToGrid,
  worldToScreen,
} from './grid';
import { GRID_SIZE } from '../constants';

describe('snapToGrid 0.5m 吸附', () => {
  it('网格点保持不变', () => {
    for (const v of [0, 0.5, 1, 2.5, 19.5, 14]) {
      expect(snapToGrid(v)).toBe(v);
    }
  });

  it('向最近网格点四舍五入', () => {
    expect(snapToGrid(0.2)).toBe(0);
    expect(snapToGrid(0.3)).toBe(0.5);
    expect(snapToGrid(1.74)).toBe(1.5);
    expect(snapToGrid(1.76)).toBe(2);
    expect(snapToGrid(-0.3)).toBe(-0.5);
    // 等距（-0.25）时按 Math.round 向 +∞ 方向取 0
    expect(Object.is(snapToGrid(-0.25), 0)).toBe(true);
  });

  it('支持自定义步长', () => {
    expect(snapToGrid(0.31, 1)).toBe(0);
    expect(snapToGrid(0.6, 1)).toBe(1);
  });

  it('不产生浮点尾巴', () => {
    expect(snapToGrid(10.3)).toBe(10.5);
    expect(Number.isFinite(snapToGrid(3.14159))).toBe(true);
  });
});

describe('屏幕 ↔ 世界坐标换算（缩放下保持准确）', () => {
  it('scale=1 且无平移时恒等', () => {
    expect(screenToWorld(120, 40, 1, { x: 0, y: 0 })).toEqual({
      x: 120,
      y: 40,
    });
  });

  it('scale=40 像素/米时正确换算', () => {
    // 画布 pan(40,40)：像素 (240,240) -> 米 (5,5)
    expect(screenToWorld(240, 240, 40, { x: 40, y: 40 })).toEqual({
      x: 5,
      y: 5,
    });
  });

  it('两个方向互逆（任意缩放/平移）', () => {
    const cases: Array<[number, number, number, { x: number; y: number }]> = [
      [0, 0, 40, { x: 40, y: 40 }],
      [537.25, 218.5, 12.5, { x: 13.25, y: -7.5 }],
      [999, 1, 200, { x: 0, y: 0 }],
      [10, 10, 0.3, { x: 100, y: 200 }],
    ];
    for (const [px, py, scale, pan] of cases) {
      const w = screenToWorld(px, py, scale, pan);
      const back = worldToScreen(w.x, w.y, scale, pan);
      expect(back.x).toBeCloseTo(px, 10);
      expect(back.y).toBeCloseTo(py, 10);
    }
  });

  it('缩放后同样的屏幕位移对应不同的米位移', () => {
    // 40 像素在 scale=40 时是 1 米，在 scale=10 时是 4 米
    expect(screenDeltaToWorld(40, 0, 40)).toEqual({ x: 1, y: 0 });
    expect(screenDeltaToWorld(40, 0, 10)).toEqual({ x: 4, y: 0 });
    expect(screenDeltaToWorld(0, -20, 5)).toEqual({ x: 0, y: -4 });
  });
});

describe('拖拽吸附与尺寸吸附', () => {
  it('拖拽位置扣除抓取偏移并吸附网格', () => {
    // 抓取点在展位内 (0.7, 0.3)；指针世界坐标 (4.2, 6.2)
    // 左上角 ≈ (3.5, 5.9) -> 吸附 (3.5, 6.0)
    const p = snapDragPosition(4.2, 6.2, { x: 0.7, y: 0.3 });
    expect(p).toEqual({ x: 3.5, y: 6 });
  });

  it('任意缩放下换算后再拖拽都落在 0.5m 网格', () => {
    // 模拟 scale=80：指针移动到像素 (243,200)，pan(40,40)，抓取偏移 (1,1)
    const pan = { x: 40, y: 40 };
    const grab = { x: 1, y: 1 };
    const scale = 80;
    const w = screenToWorld(243, 200, scale, pan);
    const next = snapDragPosition(w.x, w.y, grab);
    expect(next.x % GRID_SIZE).toBeCloseTo(0, 10);
    expect(next.y % GRID_SIZE).toBeCloseTo(0, 10);
  });

  it('尺寸吸附且不小于最小值', () => {
    expect(snapResize(2.9)).toBe(3);
    expect(snapResize(0.1)).toBe(GRID_SIZE);
    expect(snapResize(0.6)).toBe(0.5);
    expect(snapResize(0)).toBe(GRID_SIZE);
  });
});
