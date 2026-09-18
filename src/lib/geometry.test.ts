import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { CLEARANCE, HALL_HEIGHT, HALL_WIDTH } from '../constants';
import {
  clearanceViolation,
  frontEdge,
  frontPoint,
  intersects,
  outOfBounds,
  receptionPoint,
  rectOf,
  rotate90,
} from './geometry';

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 3,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

describe('intersects 轴对齐碰撞', () => {
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
});

describe('clearanceViolation 1.5m 净空', () => {
  it('左右相对：投影重叠时检查水平间距', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const near = booth({ x: 3, y: 0.5, w: 2, h: 1 }); // 间距 1.0
    expect(clearanceViolation(a, near)).toEqual({ gap: 1, axis: 'x' });
    const ok = booth({ x: 3.5, y: 0.5, w: 2, h: 1 }); // 间距 1.5
    expect(clearanceViolation(a, ok)).toBeNull();
  });

  it('上下相对：投影重叠时检查垂直间距', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const near = booth({ x: 0.5, y: 3, w: 1, h: 1 }); // 间距 1.0
    expect(clearanceViolation(a, near)).toEqual({ gap: 1, axis: 'y' });
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

  it('对称：与入参顺序无关', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 });
    expect(clearanceViolation(a, b)).toEqual(clearanceViolation(b, a));
  });

  it('自定义净宽参数生效', () => {
    const a = booth({ x: 0, y: 0, w: 2, h: 2 });
    const b = booth({ x: 3, y: 0, w: 2, h: 2 }); // gap 1.0
    expect(clearanceViolation(a, b, 1)).toBeNull();
    expect(clearanceViolation(a, b, CLEARANCE)).not.toBeNull();
  });
});

describe('rotate90', () => {
  it('交换宽高、朝向顺时针转 90°', () => {
    const r = rotate90(booth({ x: 1, y: 2, w: 3, h: 2, orientation: 'north' }));
    expect(r.w).toBe(2);
    expect(r.h).toBe(3);
    expect(r.orientation).toBe('east');
    expect(rotate90(r).orientation).toBe('south');
    // 左上角不变
    expect(r.x).toBe(1);
    expect(r.y).toBe(2);
  });

  it('连续旋转四次回到原状', () => {
    let b = booth({ w: 3, h: 2, orientation: 'west' });
    for (let i = 0; i < 4; i++) b = rotate90(b);
    expect(b.w).toBe(3);
    expect(b.h).toBe(2);
    expect(b.orientation).toBe('west');
  });
});

describe('接待点与正面', () => {
  it('接待点位于正面外侧 0.25m 的中点', () => {
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'north' })))
      .toEqual({ x: 2, y: -0.25 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'south' })))
      .toEqual({ x: 2, y: 2.25 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'west' })))
      .toEqual({ x: -0.25, y: 1 });
    expect(receptionPoint(booth({ x: 0, y: 0, w: 4, h: 2, orientation: 'east' })))
      .toEqual({ x: 4.25, y: 1 });
  });

  it('frontPoint offset=0 是边中点，frontEdge 是正面两端', () => {
    const b = booth({ x: 2, y: 3, w: 4, h: 2, orientation: 'south' });
    expect(frontPoint(b, 0)).toEqual({ x: 4, y: 5 });
    const [p1, p2] = frontEdge(b);
    expect(p1).toEqual({ x: 2, y: 5 });
    expect(p2).toEqual({ x: 6, y: 5 });
  });
});
