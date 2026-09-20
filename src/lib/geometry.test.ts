import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { CLEARANCE, HALL_HEIGHT, HALL_WIDTH } from '../constants';
import {
  boothsOverlap,
  clearanceViolation,
  clampAnchor,
  footprint,
  frontEdge,
  frontPoint,
  intersectionPolygon,
  localToWorld,
  normalizeAngle,
  outOfBounds,
  pointInBooth,
  polygonGap,
  polygonsOverlap,
  receptionPoint,
  rotate90,
  rotateVector,
  withWorldOrientation,
  worldOrientation,
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

const D90 = Math.PI / 2;

/** 点的近似相等（旋转三角函数会带 1e-16 级尾巴）。 */
function expectPoint(p: { x: number; y: number }, x: number, y: number) {
  expect(p.x).toBeCloseTo(x, 9);
  expect(p.y).toBeCloseTo(y, 9);
}
function expectPoints(got: { x: number; y: number }[], want: [number, number][]) {
  expect(got.length).toBe(want.length);
  got.forEach((p, i) => expectPoint(p, want[i][0], want[i][1]));
}

describe('footprint 与坐标变换', () => {
  it('rotation=0 时角点即未旋转矩形四角', () => {
    const b = booth({ x: 2, y: 3, w: 4, h: 1 });
    expect(footprint(b)).toEqual([
      { x: 2, y: 3 },
      { x: 6, y: 3 },
      { x: 6, y: 4 },
      { x: 2, y: 4 },
    ]);
  });

  it('localToWorld/worldToLocal 互逆（任意角度）', () => {
    const b = booth({ x: 5, y: 6, w: 3, h: 2, rotation: 0.7 });
    const w = localToWorld(b, 1.3, 0.8);
    const back = worldToLocal(b, w);
    expect(back.x).toBeCloseTo(1.3, 9);
    expect(back.y).toBeCloseTo(0.8, 9);
  });

  it('rotateVector 顺时针旋转（屏幕系 y 向下）', () => {
    expectPoint(rotateVector(D90, { x: 1, y: 0 }), 0, 1);
    expectPoint(rotateVector(Math.PI, { x: 1, y: 0 }), -1, 0);
  });
});

describe('旋转 0/90/180/270 度', () => {
  const base = () => booth({ x: 1, y: 2, w: 6, h: 2, orientation: 'north' });

  it('各档角度 footprint 正确（2×6 展位，锚点不动）', () => {
    const b0 = base();
    // 顺时针 90°：原右上 (7,2) -> 锚点正下方 (1,8)；矩形变为竖向占位
    expectPoints(footprint({ ...b0, rotation: D90 }), [
      [1, 2],
      [1, 8],
      [-1, 8],
      [-1, 2],
    ]);
    // 180°：绕锚点转到左上方向
    expectPoints(footprint({ ...b0, rotation: Math.PI }), [
      [1, 2],
      [-5, 2],
      [-5, 0],
      [1, 0],
    ]);
    // 270°：原右上 -> 锚点正上方
    expectPoints(footprint({ ...b0, rotation: 3 * D90 }), [
      [1, 2],
      [1, -4],
      [3, -4],
      [3, 2],
    ]);
  });

  it('四档外接框尺寸一致（6×2 与 2×6）', () => {
    const aabb = (b: Booth) => {
      const xs = footprint(b).map((p) => p.x);
      const ys = footprint(b).map((p) => p.y);
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    expect(aabb({ ...base(), rotation: 0 })[0]).toBeCloseTo(6, 9);
    expect(aabb({ ...base(), rotation: 0 })[1]).toBeCloseTo(2, 9);
    expect(aabb({ ...base(), rotation: D90 })[0]).toBeCloseTo(2, 9);
    expect(aabb({ ...base(), rotation: D90 })[1]).toBeCloseTo(6, 9);
    expect(aabb({ ...base(), rotation: Math.PI })[0]).toBeCloseTo(6, 9);
    expect(aabb({ ...base(), rotation: Math.PI })[1]).toBeCloseTo(2, 9);
    expect(aabb({ ...base(), rotation: 3 * D90 })[0]).toBeCloseTo(2, 9);
    expect(aabb({ ...base(), rotation: 3 * D90 })[1]).toBeCloseTo(6, 9);
  });
});

describe('polygonsOverlap / boothsOverlap 旋转碰撞', () => {
  it('轴对齐：面积相交才算碰撞，仅边/点接触不算', () => {
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 2, h: 2 }),
        booth({ x: 2, y: 0, w: 2, h: 2 })),
    ).toBe(false); // 仅边重合
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 2, h: 2 }),
        booth({ x: 0, y: 2, w: 2, h: 2 })),
    ).toBe(false);
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 2, h: 2 }),
        booth({ x: 1, y: 1, w: 2, h: 2 })),
    ).toBe(true);
  });

  it('一个完全包含另一个也是碰撞', () => {
    expect(
      boothsOverlap(booth({ x: 0, y: 0, w: 5, h: 5 }),
        booth({ x: 1, y: 1, w: 1, h: 1 })),
    ).toBe(true);
  });

  it('intersectionPolygon 返回真实相交区域（红斜纹与碰撞同源）', () => {
    // 轴对齐：2×2 与 [1,3]×[1,3] 相交为 1×1
    const r1 = intersectionPolygon(
      footprint(booth({ x: 0, y: 0, w: 2, h: 2 })),
      footprint(booth({ x: 1, y: 1, w: 2, h: 2 })),
    )!;
    const xs = r1.map((p) => p.x);
    const ys = r1.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(1, 9);
    expect(Math.max(...xs)).toBeCloseTo(2, 9);
    expect(Math.min(...ys)).toBeCloseTo(1, 9);
    expect(Math.max(...ys)).toBeCloseTo(2, 9);
    // 仅角点接触时无面积，返回 null
    expect(
      intersectionPolygon(
        footprint(booth({ x: 0, y: 0, w: 2, h: 2 })),
        footprint(booth({ x: 2, y: 2, w: 2, h: 2 })),
      ),
    ).toBeNull();
  });

  it('旋转 90° 的 2×6 展位靠近斜放围挡：角点刚好接触不算重叠', () => {
    // 竖向展位：锚点 (4,0)，顺时针 90° 后占据 x∈[2,4]、y∈[0,6]
    const b = booth({ id: 'b', x: 4, y: 0, w: 6, h: 2, rotation: D90 });
    // 45° 菱形围挡（边长 √2/2），下顶点恰好落在展位角 (2,6)：只接触不重叠
    const side = Math.SQRT2;
    const part = booth({
      id: 'p', x: 2, y: 6, w: side, h: side, rotation: Math.PI / 4, kind: 'partition',
    });
    expect(boothsOverlap(b, part)).toBe(false);
  });

  it('两个斜角真正侵入时必须报重叠（不漏报）', () => {
    const b = booth({ id: 'b', x: 4, y: 0, w: 6, h: 2, rotation: D90 });
    // 同一菱形向下推进 0.4 m，下顶点 (2,5.6) 刺入展位，展位角被包入
    const side = Math.SQRT2;
    const part = booth({
      id: 'p', x: 2, y: 5.6, w: side, h: side, rotation: Math.PI / 4, kind: 'partition',
    });
    expect(boothsOverlap(b, part)).toBe(true);
  });

  it('旋转后 AABB 相交但实体错开（角对角空隙）不误报', () => {
    // 45° 菱形（4×4）与一个落在其外接框角落、但在菱形外的小矩形
    const a = booth({ x: 0, y: 0, w: 4, h: 4, rotation: Math.PI / 4 });
    const b = booth({ x: -2.7, y: 0.1, w: 0.5, h: 0.5 });
    const boxA = footprint(a);
    const boxB = footprint(b);
    // 先确认 AABB 确实相交（否则测试无意义）
    const overlapAABB =
      Math.max(...boxA.map((p) => p.x)) > Math.min(...boxB.map((p) => p.x)) &&
      Math.max(...boxB.map((p) => p.x)) > Math.min(...boxA.map((p) => p.x)) &&
      Math.max(...boxA.map((p) => p.y)) > Math.min(...boxB.map((p) => p.y)) &&
      Math.max(...boxB.map((p) => p.y)) > Math.min(...boxA.map((p) => p.y));
    expect(overlapAABB).toBe(true);
    expect(polygonsOverlap(boxA, boxB)).toBe(false);
  });
});

describe('pointInBooth 指针命中（旋转后精确形状）', () => {
  it('命中旋转后矩形内部，漏掉仅落在旧外接 AABB 的点', () => {
    // 45° 旋转的 4×1 长条，锚点 (1,2.5)
    const b = booth({ x: 1, y: 2.5, w: 4, h: 1, rotation: Math.PI / 4 });
    const center = localToWorld(b, b.w / 2, b.h / 2);
    expect(pointInBooth(b, center)).toBe(true);
    // (1.5,2.7) 落在旋转后外接 AABB 内、但在长条实体外（其局部 y<0）
    expect(worldToLocal(b, { x: 1.5, y: 2.7 }).y).toBeLessThan(0);
    expect(pointInBooth(b, { x: 1.5, y: 2.7 })).toBe(false);
  });

  it('四档旋转后几何中心始终命中', () => {
    for (const r of [0, D90, Math.PI, 3 * D90]) {
      const b = booth({ x: 3, y: 3, w: 4, h: 2, rotation: r });
      const pts = footprint(b);
      const center = {
        x: (pts[0].x + pts[2].x) / 2,
        y: (pts[0].y + pts[2].y) / 2,
      };
      expect(pointInBooth(b, center)).toBe(true);
    }
  });
});

describe('outOfBounds 旋转后越界', () => {
  it('贴墙合法（旋转后外接框恰好在界内）', () => {
    expect(outOfBounds(booth({ x: 0, y: 0 }))).toBeNull();
    // 90°：锚点须让竖向矩形 x∈[x-h,x]、y∈[y,y+w] 落在界内
    expect(
      outOfBounds(booth({ x: 2, y: 0, w: 6, h: 2, rotation: D90 })),
    ).toBeNull();
    expect(
      outOfBounds(booth({
        x: HALL_WIDTH, y: HALL_HEIGHT - 6, w: 6, h: 2, rotation: D90,
      })),
    ).toBeNull();
  });

  it('旋转后角点越出各墙面都有描述', () => {
    // 90° 后展位占据 x∈[-1,1]：左侧越界 1 m
    expect(outOfBounds(booth({ x: 1, y: 0, w: 6, h: 2, rotation: D90 }))).toContain('左');
    // 270° 后 y 向上伸出
    expect(outOfBounds(booth({ x: 0, y: 0, w: 6, h: 2, rotation: 3 * D90 }))).toContain('顶');
    // 45° 斜放，右下超出底墙
    expect(
      outOfBounds(booth({ x: 10, y: HALL_HEIGHT - 0.5, w: 4, h: 2, rotation: Math.PI / 4 })),
    ).toContain('底');
    expect(
      outOfBounds(booth({ x: HALL_WIDTH - 0.5, y: 4, w: 4, h: 2, rotation: -Math.PI / 4 })),
    ).toContain('右');
  });
});

describe('clampAnchor 拖动钳制（旋转后整体留在范围内）', () => {
  it('90° 后按旋转外接框钳制，不会把角点甩出边界', () => {
    // 6×2 转 90° 后外接框相对锚点 minX=-2，想放到 x=-10
    const p = clampAnchor(-10, 0, 6, 2, D90, 0, 0, HALL_WIDTH, HALL_HEIGHT);
    expect(p.x).toBe(2); // -2 + 2 = 0，左边贴墙
  });

  it('允许在演示越界的边距内拖动', () => {
    const p = clampAnchor(-10, 0, 6, 2, D90, -4, -4, HALL_WIDTH + 4, HALL_HEIGHT + 4);
    expect(p.x).toBe(-2); // 角点到 x=-4
  });
});

describe('polygonGap / clearanceViolation 真实最近距离', () => {
  it('轴对齐：左右相对 1.0 m 报净空，1.5 m 合规', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    expect(clearanceViolation(a, booth({ x: 3, y: 0.5, w: 2, h: 1 }))).not.toBeNull();
    expect(clearanceViolation(a, booth({ x: 3.5, y: 0.5, w: 2, h: 1 }))).toBeNull();
  });

  it('纯对角（角对角）关系：距离 ≥1.5 时不约束', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const diag = booth({ x: 2.5, y: 2.5, w: 2, h: 2 });
    // 角点距 √(0.5²+0.5²)≈0.707，小于净空 → 仍需报（真实几何结论）
    expect(clearanceViolation(a, diag)).not.toBeNull();
    const far = booth({ x: 3.5, y: 3.5, w: 2, h: 2 }); // 角点距 √2·1.5≈2.12
    expect(clearanceViolation(a, far)).toBeNull();
  });

  it('窄间隙：旋转展位与围挡之间画面有间距时不误报', () => {
    // 竖向展位占据 x∈[2,4]、y∈[0,6]；45° 菱形围挡下顶点 (2,6.6)，垂直间隙 0.6 m
    const b = booth({ id: 'b', x: 4, y: 0, w: 6, h: 2, rotation: D90 });
    const side = Math.SQRT2;
    const part = booth({
      id: 'p', x: 2, y: 6.6, w: side, h: side, rotation: Math.PI / 4, kind: 'partition',
    });
    expect(boothsOverlap(b, part)).toBe(false);
    const v = clearanceViolation(b, part);
    expect(v).not.toBeNull();
    expect(v!.gap).toBeCloseTo(0.6, 6);
    expect(v!.gap).toBeLessThan(CLEARANCE);
  });

  it('拉开到 1.5 m 以上后净空告警消失，且 witness 点对距离等于 gap', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2, rotation: 0 });
    // 6×2 转 90° 后为竖向条 x∈[-2,0]、y∈[4,10]，与 a 下边留 2.0 m
    const b = booth({ x: 0, y: 4, w: 6, h: 2, rotation: D90 });
    expect(clearanceViolation(a, b)).toBeNull();
    const g = polygonGap(footprint(a), footprint(b));
    expect(g.gap).toBeCloseTo(2, 9);
    expect(Math.hypot(g.p1.x - g.p2.x, g.p1.y - g.p2.y)).toBeCloseTo(g.gap, 9);
  });

  it('对称：与入参顺序无关', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 });
    const va = clearanceViolation(a, b);
    const vb = clearanceViolation(b, a);
    expect(va).not.toBeNull();
    expect(vb!.gap).toBeCloseTo(va!.gap, 9);
  });

  it('自定义净宽参数生效', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 }); // gap 1.0
    expect(clearanceViolation(a, b, 1)).toBeNull();
    expect(clearanceViolation(a, b, CLEARANCE)).not.toBeNull();
  });
});

describe('rotate90 与世界朝向', () => {
  it('保持旋转后外接框左上角不变、未旋转宽高不变；局部朝向不变但世界朝向转 90°', () => {
    const b0 = booth({ x: 1, y: 2, w: 3, h: 2, rotation: 0, orientation: 'north' });
    const before = footprint(b0);
    const r = rotate90(b0);
    expect(r.w).toBe(3); // 未旋转尺寸保持
    expect(r.h).toBe(2);
    expect(r.rotation).toBeCloseTo(D90, 9);
    expect(r.orientation).toBe('north'); // 局部正面方向不变
    expect(worldOrientation(r)).toBe('east'); // 世界里正面已转向东
    // 外接框左上角不变：与旧“交换宽高”时代的落点完全一致（矩形变为 [1,3]×[2,5]）
    const box = footprint(r);
    const minX = Math.min(...box.map((p) => p.x));
    const minY = Math.min(...box.map((p) => p.y));
    expect(minX).toBeCloseTo(1, 9);
    expect(minY).toBeCloseTo(2, 9);
    expect(Math.max(...box.map((p) => p.x)) - minX).toBeCloseTo(2, 9);
    expect(Math.max(...box.map((p) => p.y)) - minY).toBeCloseTo(3, 9);
    // before 变量保留以表达“旋转前外接框左上角”这一参照
    expect(Math.min(...before.map((p) => p.x))).toBe(1);
  });

  it('连续旋转四次：外接框回到原位置，宽高、世界朝向复原', () => {
    const start = booth({ x: 4, y: 5, w: 3, h: 2, rotation: 0, orientation: 'west' });
    let b = start;
    for (let i = 0; i < 4; i++) b = rotate90(b);
    expect(b.w).toBe(3);
    expect(b.h).toBe(2);
    expect(normalizeAngle(b.rotation)).toBeCloseTo(0, 9);
    expect(b.orientation).toBe('west');
    expect(worldOrientation(b)).toBe('west');
    expectPoints(footprint(b), footprint(start).map((p) => [p.x, p.y] as [number, number]));
  });

  it('从轴对齐开始逐次旋转，世界朝向逐格顺时针', () => {
    const worlds = ['east', 'south', 'west', 'north'];
    let q = booth({ rotation: 0, orientation: 'north' });
    for (let i = 0; i < 4; i++) {
      q = rotate90(q);
      expect(worldOrientation(q)).toBe(worlds[i]);
    }
  });

  it('withWorldOrientation：旋转后把世界正面设为指定方向（反解局部朝向）', () => {
    const b = rotate90(rotate90(booth({ rotation: 0, orientation: 'south' }))); // 180°
    expect(worldOrientation(b)).toBe('north'); // south 转 180° -> north
    const fixed = withWorldOrientation(b, 'south'); // 想让世界正面仍朝南
    expect(worldOrientation(fixed)).toBe('south');
    expect(fixed.rotation).toBeCloseTo(Math.PI, 9); // 角度不变，只调局部朝向
  });

  it('normalizeAngle 把 2π 归零且无浮点尾巴', () => {
    expect(normalizeAngle(4 * D90)).toBe(0);
    expect(normalizeAngle(-D90)).toBeCloseTo(3 * D90, 9);
  });
});

describe('接待点与正面（随旋转一起转）', () => {
  it('rotation=0：接待点位于正面外侧 0.25m 的中点', () => {
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'north' })))
      .toEqual({ x: 2, y: -0.25 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'east' })))
      .toEqual({ x: 4.25, y: 1 });
  });

  it('旋转 90° 后接待点随几何旋转', () => {
    // 朝东的正面（局部右边中点外 0.25 = (4.25,1)）整体顺时针转 90° → (-1,4.25)
    const b = booth({ x: 0, y: 0, w: 4, h: 2, rotation: D90, orientation: 'east' });
    const r = receptionPoint(b);
    expect(r.x).toBeCloseTo(-1, 9);
    expect(r.y).toBeCloseTo(4.25, 9);
  });

  it('rotate90 后接待点在世界里指向新朝向（外接框左上角不变）', () => {
    // 朝南 4×2，原点锚点；旋转 90° 后世界正面朝西，外接框仍占 [0,2]×[0,3]
    const r = rotate90(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'south' }));
    expect(worldOrientation(r)).toBe('west');
    const p = receptionPoint(r);
    expect(p.x).toBeCloseTo(-0.25, 9); // 西侧外 0.25
    expect(p.y).toBeCloseTo(2, 9);
  });

  it('frontPoint offset=0 是边中点，frontEdge 是正面两端（旋转后）', () => {
    const b = booth({ x: 2, y: 3, w: 4, h: 2, rotation: 0, orientation: 'south' });
    expect(frontPoint(b, 0)).toEqual({ x: 4, y: 5 });
    const [p1, p2] = frontEdge(b);
    expect(p1).toEqual({ x: 2, y: 5 });
    expect(p2).toEqual({ x: 6, y: 5 });

    const b90 = { ...b, rotation: D90 };
    const [q1, q2] = frontEdge(b90);
    // 局部底边两端 (0,2)(4,2) 顺时针转 90° 平移后
    expectPoint(q1, 0, 3);
    expectPoint(q2, 0, 7);
  });
});
