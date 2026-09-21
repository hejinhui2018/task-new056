import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { CLEARANCE, HALL_HEIGHT, HALL_WIDTH } from '../constants';
import {
  boothContainsPoint,
  boothsOverlap,
  clearanceViolation,
  footprint,
  frontEdge,
  frontPoint,
  intersects,
  localToWorld,
  outOfBounds,
  polysOverlapPositive,
  receptionPoint,
  rectOf,
  rotate90,
  worldToLocal,
} from './geometry';

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 3,
    h: p.h ?? 2,
    rotation: p.rotation ?? 0,
    orientation: p.orientation ?? 'south',
    label: p.label ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

function pts(p: ReturnType<typeof footprint>) {
  return p.map((q) => [Math.round(q.x * 1000) / 1000, Math.round(q.y * 1000) / 1000]);
}

describe('footprint 旋转后几何', () => {
  it('rotation=0 时 footprint 即本地矩形四角', () => {
    expect(pts(footprint(booth({ x: 1, y: 2, w: 3, h: 2 })))).toEqual([
      [1, 2],
      [4, 2],
      [4, 4],
      [1, 4],
    ]);
  });

  it('90°：2×6 展位变为 6×2 占地，且绕中心旋转', () => {
    // 本地 2×6，中心 (6,4)，旋转 90 后实际占 x[3,9] × y[3,5]
    const b = booth({ x: 5, y: 1, w: 2, h: 6, rotation: 90 });
    expect(pts(footprint(b))).toEqual([
      [9, 3],
      [9, 5],
      [3, 5],
      [3, 3],
    ]);
  });

  it('180° 角点对角互换位置，占地范围不变', () => {
    const b = booth({ x: 1, y: 1, w: 3, h: 2, rotation: 180 });
    expect(pts(footprint(b))).toEqual([
      [4, 3],
      [1, 3],
      [1, 1],
      [4, 1],
    ]);
  });

  it('270° 与 -90° 等价', () => {
    const a = pts(footprint(booth({ x: 5, y: 1, w: 2, h: 6, rotation: 270 })));
    const b = pts(footprint(booth({ x: 5, y: 1, w: 2, h: 6, rotation: -90 })));
    expect(a).toEqual(b);
  });

  it('45°：正方形占地为旋转菱形，角点坐标正确', () => {
    const b = booth({ x: 1, y: 1, w: 2, h: 2, rotation: 45 });
    // 中心 (2,2)，半对角 √2
    const fp = pts(footprint(b));
    expect(fp).toEqual([
      [2, 0.586],
      [3.414, 2],
      [2, 3.414],
      [0.586, 2],
    ]);
  });

  it('localToWorld / worldToLocal 互逆', () => {
    const b = booth({ x: 5, y: 1, w: 2, h: 6, rotation: 123.5 });
    const p = { x: 7.3, y: -0.4 };
    const back = worldToLocal(b, localToWorld(b, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe('intersects 轴对齐原语（仅网格单元等天然矩形使用）', () => {
  it('面积相交才算碰撞', () => {
    expect(
      intersects(rectOf(booth({ x: 0, y: 0, w: 2, h: 2 })),
        rectOf(booth({ x: 2, y: 0, w: 2, h: 2 }))),
    ).toBe(false); // 仅边重合
    expect(
      intersects(rectOf(booth({ x: 0, y: 0, w: 2, h: 2 })),
        rectOf(booth({ x: 0, y: 2, w: 2, h: 2 }))),
    ).toBe(false);
    expect(
      intersects(rectOf(booth({ x: 0, y: 0, w: 2, h: 2 })),
        rectOf(booth({ x: 1, y: 1, w: 2, h: 2 }))),
    ).toBe(true);
    expect(
      intersects(rectOf(booth({ x: 3, y: 3, w: 1, h: 1 })),
        rectOf(booth({ x: 0, y: 0, w: 2, h: 2 }))),
    ).toBe(false);
  });

  it('一个完全包含另一个也是碰撞', () => {
    expect(
      intersects(rectOf(booth({ x: 0, y: 0, w: 5, h: 5 })),
        rectOf(booth({ x: 1, y: 1, w: 1, h: 1 }))),
    ).toBe(true);
  });
});

describe('boothsOverlap 统一 SAT 碰撞（0/90/180/270）', () => {
  it('0° 轴对齐：边相贴不算、面积重叠算', () => {
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 2, h: 2 }), booth({ x: 2, y: 0, w: 2, h: 2 })),
    ).toBe(false);
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 2, h: 2 }), booth({ x: 1, y: 1, w: 2, h: 2 })),
    ).toBe(true);
  });

  it('90/180/270 旋转后占地一致，碰撞结论与手工摆放相同', () => {
    // 同一 6×2 占地 x[3,9]×y[3,5] 的四种等价表示（中心 (6,4)）
    const variants = [
      booth({ id: 'r0', x: 3, y: 3, w: 6, h: 2, rotation: 0 }),
      booth({ id: 'r90', x: 5, y: 1, w: 2, h: 6, rotation: 90 }),
      booth({ id: 'r180', x: 3, y: 3, w: 6, h: 2, rotation: 180 }),
      booth({ id: 'r270', x: 5, y: 1, w: 2, h: 6, rotation: 270 }),
    ];
    for (const v of variants) {
      expect(pts(footprint(v)).sort()).toEqual([
        [3, 3],
        [3, 5],
        [9, 3],
        [9, 5],
      ]);
    }
    // 在 y=5 贴边放一个 6×2 不应碰撞；侵入 0.5 必须碰撞
    const touch = booth({ id: 't', x: 3, y: 5, w: 6, h: 2, rotation: 0 });
    const intrude = booth({ id: 'i', x: 3, y: 4.5, w: 6, h: 2, rotation: 0 });
    for (const v of variants) {
      expect(boothsOverlap(v, touch)).toBe(false);
      expect(boothsOverlap(v, intrude)).toBe(true);
    }
  });

  it('角点刚好接触（含 45° 斜角对斜角）不算重叠', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2, rotation: 0 });
    // 45° 菱形，左顶点恰好落在 A 的右上角 (2,2)；中心 (2+√2,2)
    const diamond = booth({ x: 2 + Math.SQRT2 - 1, y: 1, w: 2, h: 2, rotation: 45 });
    const leftV = footprint(diamond)[3]; // footprint[3]=本地左下，旋转 45° 后指向正左
    expect(leftV.x).toBeCloseTo(2, 9);
    expect(leftV.y).toBeCloseTo(2, 9);
    // 两形状仅在该点相触：正面积为 0
    expect(polysOverlapPositive(footprint(a), footprint(diamond))).toBe(false);
  });

  it('误报修复：2×6 展位旋转 90 后靠近 45° 斜放围挡，真有间距时不报重叠', () => {
    // 展位旋转后实际占 x[3,9]×y[3,5]；若忽略旋转用本地 2×6 外接矩形则是 x[5,7]×y[1,7]
    const r = booth({ id: 'r', x: 5, y: 1, w: 2, h: 6, rotation: 90 });
    // 斜围挡本地外接盒 x[4.5,7.5]×y[6.6,7.1]（与“本地外接矩形”重叠），
    // 但 45° 旋转后最低点约 y=5.61，与真实占地(y≤5)留有约 0.6m 间隙
    const partition = booth({
      id: 'p', x: 4.5, y: 6.6, w: 3, h: 0.5, rotation: 45, kind: 'partition',
    });
    expect(intersects(rectOf(r), rectOf(partition))).toBe(true); // 旧 AABB 会误报
    expect(boothsOverlap(r, partition)).toBe(false); // 统一旋转几何：无重叠
  });

  it('漏报修复：本地外接矩形分离，但旋转后形状真正侵入时必须报重叠', () => {
    const a = booth({ id: 'a', x: 1, y: 1, w: 2, h: 2, rotation: 0 });
    // 本地外接盒 x[3.2,5.2] 与 A(x≤3) 分离（gap 0.2），但旋转 45° 后左顶点
    // (3.2+1-√2, 2)=(2.786,2) 伸入 A
    const b = booth({ id: 'b', x: 3.2, y: 1, w: 2, h: 2, rotation: 45 });
    expect(intersects(rectOf(a), rectOf(b))).toBe(false); // 旧 AABB 漏报
    expect(boothsOverlap(a, b)).toBe(true); // 真实侵入
  });

  it('窄间隙（0.01m）不判重叠但判净空不足；恰好 1.5m 只不判净空', () => {
    const a = booth({ id: 'a', x: 0, y: 0, w: 2, h: 2 });
    const narrow = booth({ id: 'n', x: 2.01, y: 0, w: 2, h: 2 });
    expect(boothsOverlap(a, narrow)).toBe(false);
    expect(clearanceViolation(a, narrow)).not.toBeNull();
  });
});

describe('boothContainsPoint 指针命中（旋转形状）', () => {
  it('90° 展位：命中旋转后占地，本地外接矩形内但实际占地外不命中', () => {
    const b = booth({ x: 5, y: 1, w: 2, h: 6, rotation: 90 }); // 实占 x[3,9]y[3,5]
    expect(boothContainsPoint(b, { x: 6, y: 4 })).toBe(true); // 实际占地内
    expect(boothContainsPoint(b, { x: 5.5, y: 1.5 })).toBe(false); // 本地外接盒角、实际在外
  });

  it('45° 菱形：中心命中、菱形外角不命中', () => {
    const b = booth({ x: 1, y: 1, w: 2, h: 2, rotation: 45 });
    expect(boothContainsPoint(b, { x: 2, y: 2 })).toBe(true);
    expect(boothContainsPoint(b, { x: 1.1, y: 1.1 })).toBe(false);
  });
});

describe('outOfBounds 越界（展厅 20x14）', () => {
  it('贴墙合法', () => {
    expect(outOfBounds(booth({ x: 0, y: 0 }))).toBeNull();
    expect(outOfBounds(booth({ x: HALL_WIDTH - 3, y: HALL_HEIGHT - 2, w: 3, h: 2 }))).toBeNull();
  });

  it('各方向越界都有描述', () => {
    expect(outOfBounds(booth({ x: -0.5 }))).toContain('左');
    expect(outOfBounds(booth({ y: -1 }))).toContain('顶');
    expect(outOfBounds(booth({ x: 19, w: 3 }))).toContain('右');
    expect(outOfBounds(booth({ y: 13, h: 2 }))).toContain('底');
  });

  it('旋转后角点甩出墙也算越界，即使本地外接盒在界内', () => {
    // 4×4 本地盒 x[16,20]y[10,14] 恰好贴墙；旋转 45° 后角点超出 20 / 14
    const b = booth({ x: 16, y: 10, w: 4, h: 4, rotation: 45 });
    const reason = outOfBounds(b);
    expect(reason).not.toBeNull();
    expect(reason).toContain('右');
    expect(reason).toContain('底');
  });

  it('同一矩形旋转回 0° 后越界消失', () => {
    const b = booth({ x: 16, y: 10, w: 4, h: 4, rotation: 45 });
    expect(outOfBounds(b)).not.toBeNull();
    expect(outOfBounds({ ...b, rotation: 0 })).toBeNull();
  });
});

describe('clearanceViolation 1.5m 净空（旋转多边形最近距离）', () => {
  it('左右相对：投影重叠时检查水平间距', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const near = booth({ x: 3, y: 0.5, w: 2, h: 1 }); // 间距 1.0
    expect(clearanceViolation(a, near)).toMatchObject({ gap: 1, axis: 'x' });
    const ok = booth({ x: 3.5, y: 0.5, w: 2, h: 1 }); // 间距 1.5
    expect(clearanceViolation(a, ok)).toBeNull();
  });

  it('上下相对：投影重叠时检查垂直间距', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const near = booth({ x: 0.5, y: 3, w: 1, h: 1 }); // 间距 1.0
    expect(clearanceViolation(a, near)).toMatchObject({ gap: 1, axis: 'y' });
  });

  it('纯对角关系不判定（斜角可通行）', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const diag = booth({ x: 2.5, y: 2.5, w: 2, h: 2 });
    expect(clearanceViolation(a, diag)).toBeNull();
  });

  it('恰好 1.5m 合规，1.49m 告警', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    expect(clearanceViolation(a, booth({ x: 3.5, y: 0, w: 1, h: 2 }))).toBeNull();
    const v = clearanceViolation(a, booth({ x: 3.49, y: 0, w: 1, h: 2 }));
    expect(v).not.toBeNull();
    expect(v!.gap).toBeCloseTo(1.49, 6);
  });

  it('对称：gap/axis 与入参顺序无关', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 });
    const va = clearanceViolation(a, b)!;
    const vb = clearanceViolation(b, a)!;
    expect(va.gap).toBeCloseTo(vb.gap, 9);
    expect(va.axis).toBe(vb.axis);
  });

  it('自定义净宽参数生效', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 }); // gap 1.0
    expect(clearanceViolation(a, b, 1)).toBeNull();
    expect(clearanceViolation(a, b, CLEARANCE)).not.toBeNull();
  });

  it('旋转展位与斜围挡：真实最近间距 <1.5 时报净空不足但不误报重叠', () => {
    // 展位实占 y∈[3,5]，本地外接盒 x[5,7]×y[1,7]。
    // 45° 围挡（3×0.5，竖向半外延≈1.237）本地盒 x[4.5,7.5]×y[6.04,6.54]
    // 与旧外接盒相交，但旋转后是菱形、最高点仅 ≈5.05，留有约 0.05m 真间隙。
    const r = booth({ id: 'r', x: 5, y: 1, w: 2, h: 6, rotation: 90 });
    const close = booth({
      id: 'p', x: 4.5, y: 6.04, w: 3, h: 0.5, rotation: 45, kind: 'partition',
    });
    expect(intersects(rectOf(r), rectOf(close))).toBe(true); // 旧 AABB 误报重叠
    expect(boothsOverlap(r, close)).toBe(false);
    const v = clearanceViolation(r, close);
    expect(v).not.toBeNull();
    expect(v!.gap).toBeGreaterThan(0);
    expect(v!.gap).toBeLessThan(CLEARANCE);

    // 围挡下移到真实间距 ≥1.5：既不重叠也不净空
    const far = booth({
      id: 'p2', x: 4.5, y: 8, w: 3, h: 0.5, rotation: 45, kind: 'partition',
    });
    expect(boothsOverlap(r, far)).toBe(false);
    expect(clearanceViolation(r, far)).toBeNull();
  });

  it('最近点连线确实落在两个形状上', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 });
    const v = clearanceViolation(a, b)!;
    expect(v.pa).toEqual({ x: 2, y: 1 }); // A 右边中点
    expect(v.pb).toEqual({ x: 3, y: 1 }); // B 左边中点
  });
});

describe('rotate90（保持精确尺寸，仅累加角度/朝向）', () => {
  it('宽高不变、角度 +90、朝向顺时针转 90°、中心不动', () => {
    const b0 = booth({ x: 1, y: 2, w: 3, h: 2, rotation: 0, orientation: 'north' });
    const r = rotate90(b0);
    expect(r.w).toBe(3);
    expect(r.h).toBe(2);
    expect(r.rotation).toBe(90);
    expect(r.orientation).toBe('east');
    expect(r.x + r.w / 2).toBe(b0.x + b0.w / 2);
    expect(r.y + r.h / 2).toBe(b0.y + b0.h / 2);
  });

  it('连续旋转四次回到原状（角度、尺寸、朝向）', () => {
    let b = booth({ x: 1, y: 1, w: 3, h: 2, rotation: 30, orientation: 'west' });
    for (let i = 0; i < 4; i++) b = rotate90(b);
    expect(b.w).toBe(3);
    expect(b.h).toBe(2);
    expect(b.rotation).toBe(30);
    expect(b.orientation).toBe('west');
  });

  it('270° 再转一次归一化回 0，而不是 360', () => {
    let b = booth({ rotation: 270, orientation: 'west' });
    b = rotate90(b);
    expect(b.rotation).toBe(0);
    expect(b.orientation).toBe('north');
  });
});

describe('接待点与正面（旋转后）', () => {
  it('rotation=0：接待点位于正面外侧 0.25m 的中点', () => {
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'north' })))
      .toEqual({ x: 2, y: -0.25 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'south' })))
      .toEqual({ x: 2, y: 2.25 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'west' })))
      .toEqual({ x: -0.25, y: 1 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'east' })))
      .toEqual({ x: 4.25, y: 1 });
  });

  it('rotation=90 且朝东：接待点在世界右侧边中点外 0.25m', () => {
    // 4×2 旋转 90 后占地 x[1,3]×y[-1,3]，右边 x=3（y -1..3）
    const b = booth({ x: 0, y: 0, w: 4, h: 2, rotation: 90, orientation: 'east' });
    expect(receptionPoint(b)).toEqual({ x: 3.25, y: 1 });
    const [e1, e2] = frontEdge(b);
    expect(e1).toEqual({ x: 3, y: -1 });
    expect(e2).toEqual({ x: 3, y: 3 });
  });

  it('frontPoint offset=0 是正面边中点', () => {
    const b = booth({ x: 2, y: 3, w: 4, h: 2, orientation: 'south' });
    expect(frontPoint(b, 0)).toEqual({ x: 4, y: 5 });
  });
});
