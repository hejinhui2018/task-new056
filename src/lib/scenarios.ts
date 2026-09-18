/**
 * 内置方案：
 * - emptyPlan：空白展厅
 * - blockedExitScenario：出口被堵示例
 *   1) 左上角由“围挡-横”(0,5) 与“围挡-竖”(7,0) 两面围挡与两面外墙
 *      围出一个封闭区，A01 困在区内，两个出口都不可达；
 *      把“围挡-竖”拖走，封闭区打开，A01 的疏散路径立即恢复。
 *   2) B09 紧贴南墙，整体盖住南出口（x 3~5 m），南出口被封，
 *      所有疏散路径只能绕去北出口；把 B09 拖开后路径重新分流。
 * 正常展位之间均预留 ≥1.5 m 净宽，告警只来自上面两处刻意设计。
 */
import type { Booth, PlanState } from '../types';
import { nextId } from './id';

const PALETTE = [
  '#4f86c6',
  '#8a6cb8',
  '#b35c6b',
  '#c98a3d',
  '#3f9e7c',
  '#4a9aa8',
  '#5f7d8f',
  '#9c7a4d',
  '#6d8b5a',
  '#a85d84',
  '#7d7d7d',
];

export interface BoothSeed {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  orientation?: Booth['orientation'];
  color?: string;
  kind?: 'booth' | 'partition';
}

function makeBooths(seeds: BoothSeed[]): Booth[] {
  return seeds.map((s, i) => ({
    id: nextId(),
    x: s.x,
    y: s.y,
    w: s.w,
    h: s.h,
    orientation: s.orientation ?? 'south',
    label: s.label,
    color: s.color ?? PALETTE[i % PALETTE.length],
    kind: s.kind ?? 'booth',
  }));
}

export function emptyPlan(): PlanState {
  return { booths: [] };
}

export function blockedExitScenario(): PlanState {
  return {
    booths: makeBooths([
      // —— 封闭区围挡（转角相接，0 间距，与北墙、西墙合围）——
      {
        x: 0, y: 5, w: 7, h: 1, label: '围挡-横',
        orientation: 'south', color: '#8d6e63', kind: 'partition',
      },
      {
        x: 7, y: 0, w: 1, h: 6, label: '围挡-竖',
        orientation: 'east', color: '#8d6e63', kind: 'partition',
      },
      // —— 被困展位：封闭区内，两个出口都不可达 ——
      { x: 1.5, y: 1.5, w: 2.5, h: 1.5, label: 'A01', orientation: 'south' },
      // —— 南出口正前方的堵点：3 m 宽整体盖住 2 m 宽出口 ——
      {
        x: 2.5, y: 12, w: 3, h: 2, label: 'B09',
        orientation: 'north', color: '#c0504d',
      },
      // —— 正常展位（相互净宽均 ≥1.5 m）——
      { x: 9.5, y: 0.5, w: 3, h: 2, label: 'A02', orientation: 'south' },
      { x: 14, y: 4.5, w: 3, h: 2, label: 'A03', orientation: 'west' },
      { x: 9.5, y: 6.5, w: 2, h: 2, label: 'A04', orientation: 'east' },
      { x: 13.5, y: 8, w: 2.5, h: 2, label: 'A05', orientation: 'north' },
      { x: 9, y: 11, w: 3, h: 2, label: 'A06', orientation: 'south' },
      { x: 14.5, y: 11.5, w: 3, h: 2, label: 'A07', orientation: 'west' },
      { x: 0.5, y: 8.5, w: 3, h: 2, label: 'A08', orientation: 'east' },
    ]),
  };
}

/** 新建展位的默认参数。 */
export function newBoothAt(x: number, y: number, index: number): Booth {
  return {
    id: nextId(),
    x,
    y,
    w: 3,
    h: 2,
    orientation: 'south',
    label: `B${String(index + 1).padStart(2, '0')}`,
    color: PALETTE[index % PALETTE.length],
    kind: 'booth',
  };
}
