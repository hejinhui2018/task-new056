import { describe, it, expect, beforeEach } from 'vitest';
import type { PlanState } from '../types';
import { loadPlan, savePlan, clearSavedPlan } from './persistence';
import { STORAGE_KEY } from '../constants';

/** 最小内存版 localStorage（node 测试环境无 window.localStorage）。 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: unknown }).localStorage =
    new MemoryStorage();
});

function storage(): MemoryStorage {
  return (globalThis as unknown as { localStorage: MemoryStorage }).localStorage;
}

describe('savePlan / loadPlan 刷新恢复', () => {
  it('旋转角与精确尺寸往返保存后完全保持', () => {
    const plan: PlanState = {
      booths: [
        {
          id: 'a', x: 3.5, y: 2, w: 2, h: 6, rotation: 90,
          orientation: 'east', label: 'A1', color: '#123456', kind: 'booth',
        },
        {
          id: 'b', x: 4.5, y: 6.04, w: 3, h: 0.5, rotation: 45,
          orientation: 'south', label: '围挡', color: '#8d6e63', kind: 'partition',
        },
        {
          id: 'c', x: 0, y: 0, w: 1.5, h: 1.5, rotation: 270,
          orientation: 'west', label: 'C', color: '#fff',
        },
      ],
    };
    savePlan(plan);
    const loaded = loadPlan();
    expect(loaded).toEqual(plan);
  });

  it('角度 360/720 与 -90 归一化', () => {
    savePlan({
      booths: [
        { id: 'a', x: 0, y: 0, w: 1, h: 1, rotation: 360, orientation: 'south', label: 'a', color: '#000' },
        { id: 'b', x: 0, y: 0, w: 1, h: 1, rotation: -90, orientation: 'south', label: 'b', color: '#000' },
      ],
    });
    const loaded = loadPlan()!;
    expect(loaded.booths.find((b) => b.id === 'a')!.rotation).toBe(0);
    expect(loaded.booths.find((b) => b.id === 'b')!.rotation).toBe(270);
  });

  it('旧版本数据（无 rotation 字段）迁移：补 rotation=0，占地形状/尺寸/朝向不变', () => {
    const legacy = {
      booths: [
        // 旧模型：w/h 即轴对齐占地，orientation 只决定接待点
        { id: 'old1', x: 5, y: 1, w: 2, h: 6, orientation: 'east', label: 'L1', color: '#000', kind: 'booth' },
        { id: 'old2', x: 0, y: 5, w: 7, h: 1, orientation: 'south', label: '围挡-横', color: '#8d6e63', kind: 'partition' },
      ],
    };
    storage().setItem(
      STORAGE_KEY,
      JSON.stringify(legacy),
    );
    const loaded = loadPlan()!;
    expect(loaded.booths).toHaveLength(2);
    const b1 = loaded.booths[0];
    expect(b1.rotation).toBe(0);
    expect(b1.x).toBe(5);
    expect(b1.y).toBe(1);
    expect(b1.w).toBe(2);
    expect(b1.h).toBe(6);
    expect(b1.orientation).toBe('east');
    expect(b1.kind).toBe('booth');
  });

  it('损坏/缺字段数据安全返回 null', () => {
    const ls = storage();
    ls.setItem(STORAGE_KEY, 'not json');
    expect(loadPlan()).toBeNull();
    ls.setItem(STORAGE_KEY, JSON.stringify({ booths: [{ id: 'x' }] }));
    expect(loadPlan()).toBeNull();
    ls.setItem(STORAGE_KEY, JSON.stringify({ nope: [] }));
    expect(loadPlan()).toBeNull();
  });

  it('clearSavedPlan 后读不到方案', () => {
    savePlan({ booths: [] });
    expect(loadPlan()).toEqual({ booths: [] });
    clearSavedPlan();
    expect(loadPlan()).toBeNull();
  });
});
