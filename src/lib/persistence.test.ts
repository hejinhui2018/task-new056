import { describe, it, expect, beforeEach } from 'vitest';
import type { PlanState } from '../types';
import { STORAGE_KEY } from '../constants';
import { clearSavedPlan, loadPlan, savePlan } from './persistence';

/** node 测试环境没有 localStorage，用内存 Map 打桩。 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

function setStorage(s: MemoryStorage) {
  (globalThis as unknown as { localStorage: unknown }).localStorage = s;
}
function storage(): MemoryStorage {
  return (globalThis as unknown as { localStorage: MemoryStorage }).localStorage;
}

beforeEach(() => {
  setStorage(new MemoryStorage());
});

function rotatedPlan(rotation: number): PlanState {
  return {
    booths: [
      {
        id: 'b1', x: 3.5, y: 2, w: 6, h: 2, rotation,
        orientation: 'east', label: 'A01', color: '#000', kind: 'booth',
      },
    ],
  };
}

describe('persistence 旋转角度与尺寸持久化', () => {
  it('保存含 rotation 的方案后能原样恢复（角度与未旋转尺寸都不丢）', () => {
    const plan = rotatedPlan(3 * (Math.PI / 2)); // 270°
    savePlan(plan);
    const loaded = loadPlan();
    expect(loaded).not.toBeNull();
    expect(loaded!.booths[0].rotation).toBeCloseTo((3 * Math.PI) / 2, 12);
    expect(loaded!.booths[0].w).toBe(6);
    expect(loaded!.booths[0].h).toBe(2);
    expect(loaded!.booths[0].orientation).toBe('east');
  });

  it('旧版本数据（无 rotation 字段）加载时迁移为 0，尺寸保持原值', () => {
    const legacy = JSON.stringify({
      booths: [
        { id: 'b1', x: 1, y: 1, w: 2, h: 6, orientation: 'west', label: 'L', color: '#fff' },
      ],
    });
    storage().setItem(
      STORAGE_KEY,
      legacy,
    );
    const loaded = loadPlan();
    expect(loaded).not.toBeNull();
    expect(loaded!.booths[0].rotation).toBe(0);
    expect(loaded!.booths[0].w).toBe(2); // 旧的未旋转宽高不被交换
    expect(loaded!.booths[0].h).toBe(6);
    expect(loaded!.booths[0].orientation).toBe('west');
  });

  it('非法 rotation（NaN/字符串）的方案被拒绝', () => {
    const bad = JSON.stringify({
      booths: [{ id: 'b', x: 0, y: 0, w: 1, h: 1, rotation: '90', orientation: 'south', label: 'L', color: '#000' }],
    });
    storage().setItem(STORAGE_KEY, bad);
    expect(loadPlan()).toBeNull();
  });

  it('清空后读取为 null', () => {
    savePlan(rotatedPlan(0));
    clearSavedPlan();
    expect(loadPlan()).toBeNull();
  });
});
