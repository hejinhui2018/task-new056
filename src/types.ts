/** 全局领域类型：所有坐标、尺寸单位均为“米”，展厅坐标系原点在左上角，x 向右、y 向下。 */

/** 展位朝向：接待点（正面）所在方向。旋转 90° 时在 north/east 间切换。 */
export type Orientation = 'north' | 'east' | 'south' | 'west';

export interface Point {
  x: number;
  y: number;
}

/**
 * 展位。x/y 为本地（未旋转）包围矩形左上角；w/h 为未旋转尺寸；
 * rotation 为绕矩形中心顺时针旋转的角度（度，可为任意值，旋钮每次 +90°）。
 * 渲染、命中、碰撞、越界、净空与寻路障碍一律取旋转后的多边形 footprint，
 * 不允许再用未旋转的 w/h 外接矩形作最终结论。
 */
export interface Booth {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 绕中心顺时针旋转角（度）。0/90/180/270 为常用值，几何支持任意角。 */
  rotation: number;
  /** 接待点（正面）方向；旋转旋钮时随 rotation 同步转动。 */
  orientation: Orientation;
  label: string;
  color: string;
  /** booth=普通展位（适用 1.5 m 净空规则）；partition=围挡/隔断，允许互相拼接 */
  kind?: 'booth' | 'partition';
}

/** 固定出口：位于某面墙上的一段开口（沿墙方向的起止坐标）。 */
export interface ExitDef {
  id: string;
  wall: 'north' | 'south' | 'west' | 'east';
  /** 沿墙方向的起始坐标（米） */
  start: number;
  /** 沿墙方向的结束坐标（米，start < end） */
  end: number;
}

export interface PlanState {
  booths: Booth[];
}

export type AlertKind =
  | 'out-of-bounds'
  | 'overlap'
  | 'clearance'
  | 'exit-blocked'
  | 'no-path';

export interface Alert {
  id: string;
  kind: AlertKind;
  /** 主展位 id（越界/净空/不可达是一个展位，重叠取两个中的第一个） */
  boothId: string;
  /** 相关展位：重叠时为对方；净空时为距离过近的展位；其他情况为空 */
  relatedBoothId?: string;
  message: string;
}

/** 一次分析结果：告警 + 每个展位正面接待点到最近出口的路径（网格点，米坐标）。 */
export interface AnalysisResult {
  alerts: Alert[];
  paths: Record<string, Point[]>;
  /** 被展位直接封住（开口内侧网格被占）的出口 id */
  blockedExitIds: string[];
}
