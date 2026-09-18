import { describe, it, expect } from 'vitest';
import type { Booth } from '../types';
import { analyzePlan, alertsForBooth } from './validation';
import { blockedExitScenario } from './scenarios';

function booth(p: Partial<Booth>): Booth {
  return {
    id: p.id ?? 'b',
    x: p.x ?? 0,
    y: p.y ?? 0,
    w: p.w ?? 2,
    h: p.h ?? 2,
    orientation: p.orientation ?? 'south',
    label: p.label ?? p.id ?? 'T',
    color: '#000',
    kind: p.kind ?? 'booth',
  };
}

describe('analyzePlan', () => {
  it('空方案：无告警', () => {
    const r = analyzePlan([]);
    expect(r.alerts).toEqual([]);
    expect(r.blockedExitIds).toEqual([]);
    expect(r.paths).toEqual({});
  });

  it('空展厅里的展位全部可达', () => {
    const r = analyzePlan([
      booth({ id: 'a', x: 9, y: 6 }),
      booth({ id: 'b', x: 1, y: 1 }),
    ]);
    expect(r.paths.a.length).toBeGreaterThan(1);
    expect(r.paths.b.length).toBeGreaterThan(1);
    expect(r.alerts).toEqual([]);
  });

  it('重叠展位报 overlap，且不再重复报净空', () => {
    const r = analyzePlan([
      booth({ id: 'a', x: 0, y: 0, w: 3, h: 2 }),
      booth({ id: 'b', x: 2, y: 1, w: 3, h: 2 }),
    ]);
    const kinds = r.alerts.map((a) => a.kind);
    expect(kinds).toContain('overlap');
    expect(kinds).not.toContain('clearance');
    const overlap = r.alerts.find((a) => a.kind === 'overlap')!;
    expect(new Set([overlap.boothId, overlap.relatedBoothId])).toEqual(
      new Set(['a', 'b']),
    );
  });

  it('间距 1m 报净空不足；拉开到 1.5m 后告警消失', () => {
    const near = analyzePlan([
      booth({ id: 'a', x: 0, y: 0, w: 2, h: 2 }),
      booth({ id: 'b', x: 3, y: 0, w: 2, h: 2 }),
    ]);
    expect(near.alerts.some((a) => a.kind === 'clearance')).toBe(true);

    const ok = analyzePlan([
      booth({ id: 'a', x: 0, y: 0, w: 2, h: 2 }),
      booth({ id: 'b', x: 3.5, y: 0, w: 2, h: 2 }),
    ]);
    expect(ok.alerts).toEqual([]);
  });

  it('越界展位报 out-of-bounds 且消息含方向', () => {
    const r = analyzePlan([booth({ id: 'a', x: -1, y: 13, w: 3, h: 2 })]);
    const oob = r.alerts.filter((a) => a.kind === 'out-of-bounds');
    expect(oob.length).toBe(1);
    expect(oob[0].message).toContain('越界');
  });

  it('围挡之间允许拼接，不产生重叠/净空告警', () => {
    const r = analyzePlan([
      booth({ id: 'p1', x: 0, y: 5, w: 7, h: 1, kind: 'partition' }),
      booth({ id: 'p2', x: 7, y: 0, w: 1, h: 6, kind: 'partition' }),
    ]);
    expect(r.alerts.filter((a) => a.kind !== 'no-path')).toEqual([]);
  });

  it('alertsForBooth 同时覆盖主展位与相关展位', () => {
    const r = analyzePlan([
      booth({ id: 'a', x: 0, y: 0 }),
      booth({ id: 'b', x: 1.5, y: 0 }),
    ]);
    expect(alertsForBooth(r, 'a').length).toBe(1);
    expect(alertsForBooth(r, 'b').length).toBe(1);
    expect(alertsForBooth(r, 'zzz')).toEqual([]);
  });
});

describe('内置“出口被堵”示例方案', () => {
  const plan = blockedExitScenario();
  const byLabel = (label: string) =>
    plan.booths.find((b) => b.label === label)!;

  it('初始：南出口被封、只有 A01 不可达，无其他意外告警', () => {
    const r = analyzePlan(plan.booths);
    expect(r.blockedExitIds).toEqual(['exit-south']);

    const exitAlerts = r.alerts.filter((a) => a.kind === 'exit-blocked');
    expect(exitAlerts.length).toBe(1);
    expect(exitAlerts[0].boothId).toBe(byLabel('B09').id);

    const noPath = r.alerts.filter((a) => a.kind === 'no-path');
    expect(noPath.map((a) => a.boothId)).toEqual([byLabel('A01').id]);

    // 其余类型告警不应出现
    expect(r.alerts.filter((a) => a.kind === 'overlap')).toEqual([]);
    expect(r.alerts.filter((a) => a.kind === 'clearance')).toEqual([]);
    expect(r.alerts.filter((a) => a.kind === 'out-of-bounds')).toEqual([]);

    // 其他普通展位均有疏散路径（围挡不参与疏散检查）
    for (const b of plan.booths) {
      if (b.label === 'A01') expect(r.paths[b.id]).toEqual([]);
      else if (b.kind !== 'partition')
        expect(r.paths[b.id].length).toBeGreaterThan(0);
    }
  });

  it('移动一个展位（拖开围挡-竖）后，A01 的疏散路径立即恢复', () => {
    const moved = plan.booths.map((b) =>
      b.label === '围挡-竖' ? { ...b, x: 18.5 } : b,
    );
    const r = analyzePlan(moved);
    const a01 = moved.find((b) => b.label === 'A01')!;
    expect(r.paths[a01.id].length).toBeGreaterThan(0);
    expect(r.alerts.some((a) => a.kind === 'no-path')).toBe(false);
  });

  it('拖开 B09 后南出口立即解封（A01 仍因封闭区不可达）', () => {
    const moved = plan.booths.map((b) =>
      b.label === 'B09' ? { ...b, x: 0, y: 12 } : b,
    );
    const r = analyzePlan(moved);
    expect(r.blockedExitIds).toEqual([]);
    expect(r.alerts.some((a) => a.kind === 'exit-blocked')).toBe(false);
    expect(
      r.alerts.some(
        (a) => a.kind === 'no-path' && a.boothId === byLabel('A01').id,
      ),
    ).toBe(true);
  });
});
