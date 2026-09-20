import { describe, it, expect } from 'vitest';
import { History } from './history';
import type { PlanState } from '../types';

function state(n: number): PlanState {
  return { booths: [{ id: String(n), x: n, y: 0, w: 1, h: 1, rotation: 0, orientation: 'south' as const, label: String(n), color: '#000' }] };
}

/** 带旋转的展位快照（验证撤销/重做不丢角度与未旋转尺寸）。 */
function rotatedState(rotation: number): PlanState {
  return {
    booths: [{
      id: 'r', x: 3, y: 2, w: 6, h: 2, rotation,
      orientation: 'west' as const, label: 'R', color: '#000',
    }],
  };
}

describe('History 撤销/重做', () => {
  it('初始状态可读，不能撤销/重做', () => {
    const h = new History<PlanState>(state(0));
    expect(h.current).toEqual(state(0));
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('commit 后可撤销、撤销后可重做', () => {
    const h = new History<PlanState>(state(0));
    h.commit(state(1));
    expect(h.current).toEqual(state(1));
    expect(h.canUndo).toBe(true);

    expect(h.undo()).toEqual(state(0));
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toEqual(state(1));
  });

  it('撤销后提交新状态会丢弃 redo 栈', () => {
    const h = new History<PlanState>(state(0));
    h.commit(state(1));
    h.commit(state(2));
    h.undo(); // -> 1
    h.commit(state(3)); // 分支
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toEqual(state(1));
    expect(h.undo()).toEqual(state(0));
    expect(h.canUndo).toBe(false);
  });

  it('空操作（状态相等）不入历史', () => {
    const h = new History<number>(1);
    h.commit(1);
    expect(h.canUndo).toBe(false);
    h.commit(2);
    h.commit(2);
    expect(h.undo()).toBe(1);
  });

  it('自定义 equals：内容相同的方案不产生记录', () => {
    const eq = (a: PlanState, b: PlanState) =>
      JSON.stringify(a) === JSON.stringify(b);
    const h = new History<PlanState>(state(1), 100, eq);
    h.commit(state(1)); // 新对象但内容相同
    expect(h.canUndo).toBe(false);
  });

  it('超过容量时丢弃最早记录', () => {
    const h = new History<number>(0, 3);
    for (let i = 1; i <= 5; i++) h.commit(i);
    // past 最多保留 3 条：undo 三次到底
    expect(h.undo()).toBe(4);
    expect(h.undo()).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.canUndo).toBe(false);
  });

  it('undo/redo 在边界处无副作用', () => {
    const h = new History<number>(7);
    expect(h.undo()).toBe(7);
    expect(h.redo()).toBe(7);
  });

  it('reset 清空历史并建立新基线', () => {
    const h = new History<number>(0);
    h.commit(1);
    h.commit(2);
    h.reset(99);
    expect(h.current).toBe(99);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });

  it('旋转操作的撤销/重做精确保持角度与未旋转尺寸', () => {
    const h = new History<PlanState>(rotatedState(0));
    h.commit(rotatedState(Math.PI / 2));
    h.commit(rotatedState(Math.PI));
    // 撤销回 90°：rotation、w/h、锚点都应原样
    const back90 = h.undo();
    const b90 = back90.booths[0];
    expect(b90.rotation).toBeCloseTo(Math.PI / 2, 12);
    expect(b90.w).toBe(6);
    expect(b90.h).toBe(2);
    expect(b90.x).toBe(3);
    // 重做恢复 180°
    const again = h.redo();
    expect(again.booths[0].rotation).toBeCloseTo(Math.PI, 12);
    expect(again.booths[0].w).toBe(6);
    expect(again.booths[0].h).toBe(2);
  });
});
