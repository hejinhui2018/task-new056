import { describe, it, expect } from 'vitest';
import {
  dragAnchor,
  resizeLocal,
  screenDeltaToWorld,
  screenToWorld,
  snapDragPosition,
  snapResize,
  snapToGrid,
  worldToScreen,
} from './grid';
import { rotateVector } from './geometry';
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

describe('dragAnchor 拖动中旋转', () => {
  const D90 = Math.PI / 2;

  it('未旋转时与 snapDragPosition 一致', () => {
    const grab = { x: 1, y: 0.5 };
    expect(dragAnchor({ x: 4, y: 2.5 }, grab, 0)).toEqual(
      snapDragPosition(4, 2.5, grab),
    );
  });

  it('旋转后抓取的是同一个局部点：锚点随角度正确偏移', () => {
    // 抓取局部点 (1,0)；展位顺时针 90° 后该点在锚点下方 1 m。
    const grab = { x: 1, y: 0 };
    // 指针在 (5,7)：锚点 = (5,7) - 旋转后的(1,0)=(0,1) = (5,6)，再吸附
    expect(dragAnchor({ x: 5, y: 7 }, grab, D90)).toEqual({ x: 5, y: 6 });
    // 同一展位 180°：(1,0) -> (-1,0)，锚点 = (6,6)
    expect(dragAnchor({ x: 5, y: 6 }, grab, Math.PI)).toEqual({ x: 6, y: 6 });
    // 270°：(1,0) -> (0,-1)
    expect(dragAnchor({ x: 5, y: 5 }, grab, 3 * D90)).toEqual({ x: 5, y: 6 });
  });

  it('模拟“拖动会话中途旋转”：同一局部抓取点在不同角度下都抓得准', () => {
    // 会话开始：未旋转展位锚点 (2,2)，抓取局部中心 (1,1)
    const grab = { x: 1, y: 1 };
    // 先把指针放到抓取点（世界 (3,3)），算出的锚点应为 2,2
    expect(dragAnchor({ x: 3, y: 3 }, grab, 0)).toEqual({ x: 2, y: 2 });
    // 会话期间展位被旋转 90°（指针未动）：局部中心旋到 (-1,1)，
    // 锚点 = (3,3)-(-1,1) = (4,2)——即展位绕抓取点保持贴合，不跳变。
    expect(dragAnchor({ x: 3, y: 3 }, grab, D90)).toEqual({ x: 4, y: 2 });
    // 再转 90°（180°）：(1,1)->(-1,-1)，锚点=(4,4)
    expect(dragAnchor({ x: 3, y: 3 }, grab, Math.PI)).toEqual({ x: 4, y: 4 });
  });

  it('结果始终吸附到 0.5 m 网格（四档角度）', () => {
    const grab = { x: 0.7, y: 0.3 };
    for (const r of [0, D90, Math.PI, 3 * D90]) {
      const p = dragAnchor({ x: 8.23, y: 6.61 }, grab, r);
      expect(p.x % GRID_SIZE).toBeCloseTo(0, 9);
      expect(p.y % GRID_SIZE).toBeCloseTo(0, 9);
    }
  });
});

describe('resizeLocal 缩放（含旋转后）', () => {
  it('东/南手柄只改尺寸不动原点', () => {
    expect(resizeLocal(3, 2, 'e', 4.5, 1)).toEqual({ ox: 0, oy: 0, w: 4.5, h: 2 });
    expect(resizeLocal(3, 2, 's', 2, 3.5)).toEqual({ ox: 0, oy: 0, w: 3, h: 3.5 });
  });

  it('西/北手柄：新原点局部偏移与尺寸一致', () => {
    // 左边拉到局部 x=0.5：宽变为 2.5，原点 x 右移 0.5
    expect(resizeLocal(3, 2, 'w', 0.5, 1)).toEqual({ ox: 0.5, oy: 0, w: 2.5, h: 2 });
    // 上边拉到局部 y=0.5：高 1.5，原点 y 下移 0.5
    expect(resizeLocal(3, 2, 'n', 1, 0.5)).toEqual({ ox: 0, oy: 0.5, w: 3, h: 1.5 });
  });

  it('旋转 90° 后拖西手柄：局部原点偏移经旋转映射为世界向下', () => {
    // 与 FloorPlan 缩放分支同一套映射：rotateVector(π/2, (0.5,0)) = (0,0.5)
    const r = resizeLocal(3, 2, 'w', 0.5, 1);
    const d = rotateVector(Math.PI / 2, { x: r.ox, y: r.oy });
    expect(d.x).toBeCloseTo(0, 9);
    expect(d.y).toBeCloseTo(0.5, 9);
  });
});

describe('高缩放场景', () => {
  it('极高缩放下屏幕位移精确换算为小米位移并吸附（不产生漂移）', () => {
    // 600%：scale=240 像素/米；指针只移动 6 px = 0.025 m
    const scale = 240;
    const pan = { x: 40, y: 40 };
    const w0 = screenToWorld(1000, 700, scale, pan);
    const w1 = screenToWorld(1006, 700, scale, pan);
    const d = screenDeltaToWorld(6, 0, scale);
    expect(d.x).toBeCloseTo(0.025, 9);
    // 两次换算差值与 delta 一致，无累计误差
    expect(w1.x - w0.x).toBeCloseTo(0.025, 9);
    // 高缩放下 dragAnchor 仍吸附到同一网格，亚网格抖动不产生脏位置
    const grab = { x: 1, y: 1 };
    const a = dragAnchor(w0, grab, 0);
    const b = dragAnchor(w1, grab, 0);
    expect(a.x % GRID_SIZE).toBeCloseTo(0, 9);
    expect(b.x % GRID_SIZE).toBeCloseTo(0, 9);
  });

  it('旋转展位在高缩放下命中判定与渲染几何一致（点-多边形）', async () => {
    const { pointInBooth } = await import('./geometry');
    const booth = {
      id: 'b', x: 4, y: 2, w: 6, h: 2,
      rotation: Math.PI / 2, orientation: 'south' as const,
      label: 'T', color: '#000', kind: 'booth' as const,
    };
    // 旋转后占据 x∈[2,4]、y∈[2,8]；边界两侧各取一个 1 mm 级的点
    expect(pointInBooth(booth, { x: 3.999, y: 5 })).toBe(true);
    expect(pointInBooth(booth, { x: 4.001, y: 5 })).toBe(false);
  });
});
