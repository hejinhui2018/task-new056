/** 展厅与规则常量（单位：米）。 */
import type { ExitDef } from './types';

export const HALL_WIDTH = 20;
export const HALL_HEIGHT = 14;

/** 网格步长：所有交互操作吸附到 0.5 米。 */
export const GRID_SIZE = 0.5;

/** 展位之间必须保留的通道净宽（米）。 */
export const CLEARANCE = 1.5;

/** 寻路网格步长（米）。越小越精确，0.5 米与吸附网格一致。 */
export const PATH_GRID = 0.5;

/** 固定出口：南墙偏左、北墙偏右各一个。 */
export const EXITS: ExitDef[] = [
  { id: 'exit-south', wall: 'south', start: 3, end: 5 },
  { id: 'exit-north', wall: 'north', start: 14, end: 16 },
];

/** 本地存储键。 */
export const STORAGE_KEY = 'booth-planner:plan:v1';
