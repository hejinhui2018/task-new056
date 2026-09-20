/** 方案本地持久化：localStorage，带版本键与容错。无后端。 */
import type { PlanState } from '../types';
import { STORAGE_KEY } from '../constants';

export function savePlan(state: PlanState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 隐私模式 / 配额不足时静默降级，不影响编辑。
  }
}

export function loadPlan(): PlanState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    if (!isValidPlan(data)) return null;
    // 迁移：旧版本没有 rotation 字段，补 0（轴对齐），尺寸保持未旋转原值。
    return {
      booths: data.booths.map((b) =>
        typeof b.rotation === 'number' && Number.isFinite(b.rotation)
          ? b
          : { ...b, rotation: 0 },
      ),
    };
  } catch {
    return null;
  }
}

export function clearSavedPlan(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function isValidPlan(data: unknown): data is PlanState {
  if (typeof data !== 'object' || data === null) return false;
  const booths = (data as { booths?: unknown }).booths;
  if (!Array.isArray(booths)) return false;
  return booths.every((b) => {
    if (typeof b !== 'object' || b === null) return false;
    const o = b as Record<string, unknown>;
    return (
      typeof o.id === 'string' &&
      typeof o.x === 'number' &&
      typeof o.y === 'number' &&
      typeof o.w === 'number' &&
      typeof o.h === 'number' &&
      typeof o.label === 'string' &&
      (o.orientation === 'north' ||
        o.orientation === 'east' ||
        o.orientation === 'south' ||
        o.orientation === 'west') &&
        (o.rotation === undefined ||
          (typeof o.rotation === 'number' && Number.isFinite(o.rotation))) &&
        (o.kind === undefined || o.kind === 'booth' || o.kind === 'partition')
    );
  });
}
