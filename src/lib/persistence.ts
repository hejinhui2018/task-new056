/** 方案本地持久化：localStorage，带版本键与容错。无后端。 */
import type { Booth, PlanState } from '../types';
import { STORAGE_KEY } from '../constants';
import { normalizeAngle } from './scenarios';

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
    return { booths: data.booths.map(migrateBooth) };
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

/**
 * 旧方案迁移：旧模型把展位始终存为轴对齐矩形（旋转只是交换 w/h，
 * orientation 仅决定接待点方向），因此旧数据直接补 rotation=0 即可
 * 保持完全相同的占地形状、尺寸与正面方向。
 */
function migrateBooth(raw: Record<string, unknown>): Booth {
  return {
    id: raw.id as string,
    x: raw.x as number,
    y: raw.y as number,
    w: raw.w as number,
    h: raw.h as number,
    rotation:
      typeof raw.rotation === 'number' && Number.isFinite(raw.rotation)
        ? normalizeAngle(raw.rotation)
        : 0,
    orientation: raw.orientation as Booth['orientation'],
    label: raw.label as string,
    color: typeof raw.color === 'string' ? (raw.color as string) : '#4f86c6',
    kind:
      raw.kind === 'partition' || raw.kind === 'booth' ? raw.kind : undefined,
  };
}

function isValidPlan(data: unknown): data is { booths: Record<string, unknown>[] } {
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
        (o.kind === undefined || o.kind === 'booth' || o.kind === 'partition')
    );
  });
}
