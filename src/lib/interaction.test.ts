import { describe, it, expect } from 'vitest';
import type { Booth, Orientation, Point } from '../types';
import { screenToWorld } from './grid';
import { computeResize, normalizeAngle, rotationDrag } from './interaction';
import { footprint, localToWorld } from './geometry';

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 2,
    y: p.y ?? 2,
    w: p.w ?? 4,
    h: p.h ?? 2,
    rotation: p.rotation ?? 0,
    orientation: p.orientation ?? 'south',
    label: 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

const r2 = (p: Point) => ({ x: Math.round(p.x * 1e6) / 1e6, y: Math.round(p.y * 1e6) / 1e6 });

describe('normalizeAngle', () => {
  it('归一化到 [0,360) 并吸附', () => {
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(90.2)).toBe(90);
    expect(normalizeAngle(90.3)).toBe(90.5);
    expect(normalizeAngle(730)).toBe(10);
  });
});

describe('rotationDrag 拖动中旋转', () => {
  it('指针方位角增量 90° -> 角度 90、朝向顺时针转一格', () => {
    const r = rotationDrag(
      { rotation: 0, orientation: 'north', pointerAngle: 0 },
      Math.PI / 2,
    );
    expect(r.rotation).toBe(90);
    expect(r.orientation).toBe('east');
    expect(r.moved).toBe(true);
  });

  it('小幅移动（<2°）视为点击，不标记 moved，角度吸附到 0.5°', () => {
    const r = rotationDrag(
      { rotation: 0, orientation: 'south', pointerAngle: 0 },
      (1 * Math.PI) / 180,
    );
    expect(r.moved).toBe(false);
    expect(r.rotation).toBe(1);
    expect(r.orientation).toBe('south');
  });

  it('跨过 ±180° 回绕时取短路径（-179° -> +179° 视为 -2°，归一化为 358）', () => {
    const r = rotationDrag(
      { rotation: 0, orientation: 'south', pointerAngle: (-179 * Math.PI) / 180 },
      (179 * Math.PI) / 180,
    );
    expect(r.rotation).toBe(358);
    expect(r.orientation).toBe('south');
  });

  it('反向拖 90° -> 270、朝向逆时针转一格', () => {
    const r = rotationDrag(
      { rotation: 0, orientation: 'north', pointerAngle: 0 },
      -Math.PI / 2,
    );
    expect(r.rotation).toBe(270);
    expect(r.orientation).toBe('west');
  });

  it('Shift 粗吸附 5°：48° 指针增量吸附到 50°', () => {
    const r = rotationDrag(
      { rotation: 0, orientation: 'north', pointerAngle: 0 },
      (48 * Math.PI) / 180,
      5,
    );
    expect(r.rotation).toBe(50);
  });

  it('连续多次 90° 拖动经过 0/90/180/270，朝向同步循环', () => {
    let st: { rotation: number; orientation: Orientation; pointerAngle: number } = {
      rotation: 0,
      orientation: 'north',
      pointerAngle: 0,
    };
    const expected: Array<[number, string]> = [
      [90, 'east'],
      [180, 'south'],
      [270, 'west'],
      [0, 'north'],
    ];
    for (const [expRot, expOri] of expected) {
      st = {
        rotation: st.rotation,
        orientation: st.orientation,
        pointerAngle: 0,
      };
      const r = rotationDrag(st, Math.PI / 2);
      expect(r.rotation).toBe(expRot);
      expect(r.orientation).toBe(expOri);
      st = { rotation: r.rotation, orientation: r.orientation, pointerAngle: Math.PI / 2 };
    }
  });
});

describe('computeResize 旋转状态下缩放（世界锚点固定 + 网格吸附）', () => {
  it('rotation=0 拖东手柄：左边不动，宽吸附 0.5m', () => {
    const patch = computeResize(
      { x: 2, y: 2, w: 4, h: 2, rotation: 0 },
      'e',
      { x: 7.2, y: 3 },
    );
    expect(patch).toMatchObject({ x: 2, y: 2, w: 5, h: 2 });
  });

  it('rotation=90 拖东手柄：对侧锚点在世界坐标中保持不动', () => {
    const start = { x: 2, y: 2, w: 4, h: 2, rotation: 90 };
    const ref = booth(start);
    // 本地东手柄的对侧锚点 = 左边中点；其旋转后的世界位置
    const anchorBefore = r2(localToWorld(ref, { x: 2, y: 3 }));
    // 指针世界位置对应本地 x=8（把宽度从 4 拉到 6）
    const worldPointer = localToWorld(ref, { x: 8, y: 3 });
    const patch = computeResize(start, 'e', worldPointer)!;
    const next = booth({ ...start, ...patch });
    const anchorAfter = r2(localToWorld(next, { x: patch.x!, y: patch.y! + patch.h! / 2 }));
    expect(patch.w).toBe(6);
    expect(anchorAfter).toEqual(anchorBefore);
  });

  it('rotation=45 拖北手柄：南边缘锚点世界不动，尺寸吸附且角度不变', () => {
    const start = { x: 2, y: 2, w: 4, h: 4, rotation: 45 };
    const ref = booth(start);
    const anchorBefore = r2(localToWorld(ref, { x: 4, y: 6 })); // 南边中点
    // 北手柄向上（本地 y 减小）拉到 y≈0.4：高度 4 -> 5.5
    const worldPointer = localToWorld(ref, { x: 4, y: 0.4 });
    const patch = computeResize(start, 'n', worldPointer)!;
    expect(patch.h).toBe(5.5);
    const next = booth({ ...start, ...patch });
    const anchorAfter = r2(
      localToWorld(next, { x: patch.x! + patch.w! / 2, y: patch.y! + patch.h! }),
    );
    expect(anchorAfter).toEqual(anchorBefore);
  });

  it('高缩放（600 像素/米）下 1px 抖动换算后仍吸附，缩放结果确定', () => {
    // 屏幕坐标先精确换算成世界坐标再计算：缩放倍率不影响最终几何结论。
    const scale = 600;
    const pan = { x: 137.5, y: -204.25 };
    // 期望世界指针 (7.2, 3)：屏幕 = world*scale + pan
    const target = { x: 7.2, y: 3 };
    const px = target.x * scale + pan.x;
    const py = target.y * scale + pan.y;
    const w1 = screenToWorld(px, py, scale, pan);
    const w2 = screenToWorld(px + 1, py - 1, scale, pan); // ±1px 抖动
    const p1 = computeResize({ x: 2, y: 2, w: 4, h: 2, rotation: 0 }, 'e', w1);
    const p2 = computeResize({ x: 2, y: 2, w: 4, h: 2, rotation: 0 }, 'e', w2);
    expect(p1).toMatchObject({ w: 5 });
    expect(p2).toMatchObject({ w: 5 });
  });

  it('旋转展位缩放后占地与 footprint 一致（不使用旧外接矩形）', () => {
    const start = { x: 5, y: 1, w: 2, h: 6, rotation: 90 };
    const ref = booth(start);
    // 南手柄沿本地 +y（旋转 90 后即世界 -x）拉长，锚点（北边缘）世界固定：
    const anchorBefore = r2(localToWorld(ref, { x: 6, y: 1 }));
    const worldPointer = localToWorld(ref, { x: 6, y: 8 });
    const patch = computeResize(start, 's', worldPointer)!;
    expect(patch.w).toBe(2);
    expect(patch.h).toBe(7);
    const next = booth({ ...start, ...patch });
    const anchorAfter = r2(localToWorld(next, { x: patch.x! + patch.w! / 2, y: patch.y! }));
    expect(anchorAfter).toEqual(anchorBefore);
    // 旋转 90 后世界占地：横向=新 h=7，纵向=w=2，向西侧增长
    const fp = footprint(next);
    const xs = fp.map((p) => Math.round(p.x * 1e6) / 1e6).sort((a, b) => a - b);
    const ys = fp.map((p) => Math.round(p.y * 1e6) / 1e6).sort((a, b) => a - b);
    expect(xs).toEqual([2, 2, 9, 9]);
    expect(ys).toEqual([3, 3, 5, 5]);
  });
});
