/**
 * 方案实时分析：出口封堵、越界、重叠、净空不足、接待点到出口不可达。
 * 纯函数：输入展位列表，输出告警与每个展位的疏散路径。
 */
import type { Alert, AnalysisResult, Booth, Point } from '../types';
import { CLEARANCE, EXITS } from '../constants';
import {
  clearanceViolation,
  outOfBounds,
  receptionPoint,
  rectOf,
  intersects,
} from './geometry';
import { exitBlockingBooth, findExitPath } from './pathfinding';

export function exitName(id: string): string {
  if (id.includes('south')) return '南出口';
  if (id.includes('north')) return '北出口';
  return id;
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

const AXIS_TEXT: Record<'x' | 'y', string> = {
  x: '左右间距',
  y: '前后间距',
};

export function analyzePlan(booths: Booth[]): AnalysisResult {
  const alerts: Alert[] = [];
  const paths: Record<string, Point[]> = {};
  const blockedExitIds: string[] = [];
  const labelOf = new Map(booths.map((b) => [b.id, b.label]));

  // 0) 出口是否被展位直接封住
  for (const exitDef of EXITS) {
    const blocker = exitBlockingBooth(booths, exitDef);
    if (blocker) {
      blockedExitIds.push(exitDef.id);
      alerts.push({
        id: `exit-blocked:${exitDef.id}`,
        kind: 'exit-blocked',
        boothId: blocker.id,
        message: `${exitName(exitDef.id)}被展位 ${blocker.label} 封住，疏散出口不可用`,
      });
    }
  }

  // 1) 越界
  for (const b of booths) {
    const reason = outOfBounds(b);
    if (reason) {
      alerts.push({
        id: `out-of-bounds:${b.id}`,
        kind: 'out-of-bounds',
        boothId: b.id,
        message: `展位 ${b.label} 越界：${reason}`,
      });
    }
  }

  // 2) 两两：重叠 / 净空
  for (let i = 0; i < booths.length; i++) {
    for (let j = i + 1; j < booths.length; j++) {
      const a = booths[i];
      const b = booths[j];
      // 围挡是设施隔断，允许彼此拼接（不互相检查重叠/净空）；仍作为寻路障碍。
      if (a.kind === 'partition' && b.kind === 'partition') continue;
      const [lo, hi] = pairKey(a.id, b.id);
      if (intersects(rectOf(a), rectOf(b))) {
        alerts.push({
          id: `overlap:${lo}:${hi}`,
          kind: 'overlap',
          boothId: a.id,
          relatedBoothId: b.id,
          message: `展位 ${labelOf.get(a.id)} 与 ${labelOf.get(
            b.id,
          )} 区域重叠，请错开布置`,
        });
        continue; // 重叠时不再重复报净空
      }
      const violation = clearanceViolation(a, b, CLEARANCE);
      if (violation) {
        alerts.push({
          id: `clearance:${lo}:${hi}`,
          kind: 'clearance',
          boothId: a.id,
          relatedBoothId: b.id,
          message: `展位 ${labelOf.get(a.id)} 与 ${labelOf.get(
            b.id,
          )} ${AXIS_TEXT[violation.axis]}仅 ${
            Math.round(violation.gap * 100) / 100
          } m，不足 ${CLEARANCE} m 通道`,
        });
      }
    }
  }

  // 3) 接待点 -> 任一出口（围挡是设施障碍，没有接待点，不参与疏散检查）
  for (const b of booths) {
    if (b.kind === 'partition') continue;
    const start = receptionPoint(b);
    const result = findExitPath(booths, start);
    if (result.reachable) {
      paths[b.id] = result.path;
    } else {
      paths[b.id] = [];
      alerts.push({
        id: `no-path:${b.id}`,
        kind: 'no-path',
        boothId: b.id,
        message: `展位 ${b.label} 正面接待点无法抵达任一出口，疏散通道被堵`,
      });
    }
  }

  return { alerts, paths, blockedExitIds };
}

export function alertsForBooth(
  analysis: AnalysisResult,
  boothId: string,
): Alert[] {
  return analysis.alerts.filter(
    (a) => a.boothId === boothId || a.relatedBoothId === boothId,
  );
}
