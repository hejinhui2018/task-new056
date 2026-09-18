/**
 * 展厅平面图（SVG）。
 * - 内部单位 = 米；根 <g> 做 scale/pan 仿射，指针事件用 screenToWorld 精确换算。
 * - 拖动 / 8 手柄缩放 / 旋转，全程吸附 0.5 m；交互中 live 更新，松手提交一条历史。
 * - 告警直接上图：重叠区域红色斜纹、净空尺寸标注、不可达接待点 ✕、封堵出口红叉，
 *   并配合字符徽标（不只靠颜色）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Alert, Booth, Point } from '../types';
import type { PlannerApi } from '../state/usePlanner';
import {
  EXITS,
  GRID_SIZE,
  HALL_HEIGHT,
  HALL_WIDTH,
} from '../constants';
import {
  frontEdge,
  receptionPoint,
  rectOf,
  intersects,
} from '../lib/geometry';
import { screenToWorld, snapResize, snapToGrid } from '../lib/grid';

type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

interface DragSession {
  type: 'drag';
  boothId: string;
  /** 抓取点相对展位左上角的偏移（米） */
  grab: Point;
}
interface ResizeSession {
  type: 'resize';
  boothId: string;
  handle: HandleId;
  start: { x: number; y: number; w: number; h: number };
}
interface PanSession {
  type: 'pan';
  startPx: Point;
  startPan: Point;
  moved: boolean;
}
type Session = DragSession | ResizeSession | PanSession;

const MIN_SIZE = GRID_SIZE;
// 缩放倍率上下限（相对于“适应窗口”的基准比例）
const ZOOM_RATIO_MIN = 0.3;
const ZOOM_RATIO_MAX = 6;

interface FloorPlanProps {
  planner: PlannerApi;
  showPaths: boolean;
  activeAlertId: string | null;
  onActiveAlertChange: (id: string | null) => void;
  onZoomChange: (zoom: number) => void;
}

export function FloorPlan({
  planner,
  showPaths,
  activeAlertId,
  onActiveAlertChange,
  onZoomChange,
}: FloorPlanProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 1000, h: 700 });
  const [scale, setScale] = useState(40); // 每米像素数
  const [pan, setPan] = useState<Point>({ x: 40, y: 40 });
  const baseScaleRef = useRef(40);
  const [session, setSession] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;
  const panMovedRef = useRef(false);

  const { booths, analysis, selectedId } = planner;

  /* ---------- 尺寸与适应窗口 ---------- */
  /** 画布容器（svg 的父节点 .canvas-wrap）。 */
  const containerEl = () => svgRef.current?.parentElement ?? null;

  /** 把绝对比例（像素/米）钳制在允许的缩放倍率区间内。 */
  const clampScaleAbs = useCallback(
    (s: number) =>
      Math.max(
        baseScaleRef.current * ZOOM_RATIO_MIN,
        Math.min(baseScaleRef.current * ZOOM_RATIO_MAX, s),
      ),
    [],
  );

  const fit = useCallback(() => {
    const el = containerEl();
    if (!el) return;
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const s = Math.min((cw - 90) / HALL_WIDTH, (ch - 110) / HALL_HEIGHT);
    baseScaleRef.current = s; // 100% 基准
    setScale(s);
    setPan({
      x: (cw - HALL_WIDTH * s) / 2,
      y: (ch - HALL_HEIGHT * s) / 2 - 6,
    });
  }, []);

  useLayoutEffect(() => {
    const el = containerEl();
    if (!el) return;
    fit();
    // 窗口尺寸变化只更新自身尺寸，不重置用户的缩放/平移
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [fit]);

  useEffect(() => {
    onZoomChange(scale / baseScaleRef.current);
  }, [scale, onZoomChange]);

  const clampPan = useCallback(
    (p: Point, s: number) => {
      const cw = size.w;
      const ch = size.h;
      const ws = HALL_WIDTH * s;
      const hs = HALL_HEIGHT * s;
      const minX = Math.min(24, cw - ws - 24);
      const maxX = Math.max(cw - 24, 24);
      const minY = Math.min(24, ch - hs - 24);
      const maxY = Math.max(ch - 24, 24);
      return {
        x: Math.min(maxX, Math.max(minX, p.x)),
        y: Math.min(maxY, Math.max(minY, p.y)),
      };
    },
    [size],
  );

  /* ---------- 坐标换算（缩放后仍精确） ---------- */
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = svgRef.current!.getBoundingClientRect();
      return screenToWorld(
        clientX - rect.left,
        clientY - rect.top,
        scale,
        pan,
      );
    },
    [scale, pan],
  );

  /* ---------- 滚轮以光标为锚点缩放（原生非被动监听，才能 preventDefault） ---------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      if (sessionRef.current) return;
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      setScale((prevScale) => {
        const next = clampScaleAbs(prevScale * factor);
        const ratio = next / prevScale;
        setPan((prevPan) =>
          clampPan(
            {
              x: px - (px - prevPan.x) * ratio,
              y: py - (py - prevPan.y) * ratio,
            },
            next,
          ),
        );
        return next;
      });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [clampPan, clampScaleAbs]);

  const zoomBy = useCallback(
    (factor: number) => {
      setScale((prev) => {
        const next = clampScaleAbs(prev * factor);
        const px = size.w / 2;
        const py = size.h / 2;
        const ratio = next / prev;
        setPan((oldPan) =>
          clampPan(
            {
              x: px - (px - oldPan.x) * ratio,
              y: py - (py - oldPan.y) * ratio,
            },
            next,
          ),
        );
        return next;
      });
    },
    [clampPan, clampScaleAbs, size],
  );

  /* ---------- 指针会话 ---------- */
  const startBoothDrag = (e: React.PointerEvent, b: Booth) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    planner.selectBooth(b.id);
    const w = toWorld(e.clientX, e.clientY);
    setSession({
      type: 'drag',
      boothId: b.id,
      grab: { x: w.x - b.x, y: w.y - b.y },
    });
  };

  const startResize = (e: React.PointerEvent, b: Booth, handle: HandleId) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    planner.selectBooth(b.id);
    setSession({
      type: 'resize',
      boothId: b.id,
      handle,
      start: { x: b.x, y: b.y, w: b.w, h: b.h },
    });
  };

  const startPan = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    setSession({
      type: 'pan',
      startPx: { x: e.clientX, y: e.clientY },
      startPan: pan,
      moved: false,
    });
  };

  useEffect(() => {
    if (!session) return;

    const onMove = (e: PointerEvent) => {
      const s = sessionRef.current;
      if (!s) return;
      if (s.type === 'pan') {
        const dx = e.clientX - s.startPx.x;
        const dy = e.clientY - s.startPx.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) s.moved = true;
        setPan(clampPan({ x: s.startPan.x + dx, y: s.startPan.y + dy }, scale));
        return;
      }
      const w = toWorld(e.clientX, e.clientY);
      if (s.type === 'drag') {
        // 允许拖出边界以演示“越界”告警，但限制在展厅附近、且保留可见部分。
        const nx = Math.min(
          HALL_WIDTH - MIN_SIZE,
          Math.max(-4, snapToGrid(w.x - s.grab.x)),
        );
        const ny = Math.min(
          HALL_HEIGHT - MIN_SIZE,
          Math.max(-4, snapToGrid(w.y - s.grab.y)),
        );
        planner.liveUpdateBooth(s.boothId, { x: nx, y: ny });
      } else {
        const patch = applyHandle(s.start, s.handle, w.x, w.y);
        planner.liveUpdateBooth(s.boothId, patch);
      }
    };

    const onUp = () => {
      const s = sessionRef.current;
      if (s && s.type !== 'pan') planner.commitInteraction();
      if (s?.type === 'pan') panMovedRef.current = s.moved;
      setSession(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [session, scale, toWorld, clampPan, planner]);

  /* ---------- 双击添加 / 单击空白取消选中 ---------- */
  const onDoubleClick = (e: React.MouseEvent) => {
    const w = toWorld(e.clientX, e.clientY);
    if (w.x < 0 || w.y < 0 || w.x > HALL_WIDTH || w.y > HALL_HEIGHT) return;
    planner.addBoothAt(w.x, w.y);
  };

  const onBackgroundClick = () => {
    if (panMovedRef.current) {
      panMovedRef.current = false;
      return;
    }
    planner.selectBooth(null);
    onActiveAlertChange(null);
  };

  /* ---------- 派生标注 ---------- */
  const activeAlert = analysis.alerts.find((a) => a.id === activeAlertId) ?? null;
  const activeBoothIds = new Set<string>();
  if (activeAlert) {
    activeBoothIds.add(activeAlert.boothId);
    if (activeAlert.relatedBoothId)
      activeBoothIds.add(activeAlert.relatedBoothId);
  }
  const overlapRegions: Rect[] = [];
  for (let i = 0; i < booths.length; i++) {
    for (let j = i + 1; j < booths.length; j++) {
      const reg = intersectionRect(rectOf(booths[i]), rectOf(booths[j]));
      if (reg) overlapRegions.push(reg);
    }
  }
  const clearanceMarks = analysis.alerts
    .filter((a) => a.kind === 'clearance')
    .map((a) => {
      const b1 = booths.find((b) => b.id === a.boothId)!;
      const b2 = booths.find((b) => b.id === a.relatedBoothId)!;
      return clearanceDimension(b1, b2);
    })
    .filter(Boolean) as ClearanceMark[];

  /* 屏幕常量（随缩放反向补偿，使线宽/字号视觉恒定） */
  const u = 1 / scale; // 1 像素对应的米数
  const fs = 12 * u;

  return (
    <>
      <svg
        ref={svgRef}
        style={{ cursor: session?.type === 'pan' ? 'grabbing' : 'default' }}
      >
        <defs>
          <pattern
            id="hatch-red"
            patternUnits="userSpaceOnUse"
            width={0.22}
            height={0.22}
            patternTransform="rotate(45)"
          >
            <rect width={0.22} height={0.22} fill="rgba(185,28,28,0.18)" />
            <line x1="0" y1="0" x2="0" y2={0.22} stroke="#b91c1c" strokeWidth={0.05} />
          </pattern>
          <pattern
            id="hatch-amber"
            patternUnits="userSpaceOnUse"
            width={0.22}
            height={0.22}
            patternTransform="rotate(45)"
          >
            <rect width={0.22} height={0.22} fill="rgba(245,158,11,0.08)" />
            <line x1="0" y1="0" x2="0" y2={0.22} stroke="#d97706" strokeWidth={0.04} />
          </pattern>
          {/* 围挡砖纹 */}
          <pattern
            id="hatch-partition"
            patternUnits="userSpaceOnUse"
            width={0.5}
            height={0.4}
          >
            <rect width={0.5} height={0.4} fill="#d7ccc8" />
            <line x1="0" y1="0" x2="0.5" y2="0" stroke="#8d6e63" strokeWidth={0.03} />
            <line x1="0" y1="0.2" x2="0.5" y2="0.2" stroke="#8d6e63" strokeWidth={0.02} />
            <line x1="0" y1="0.4" x2="0.5" y2="0.4" stroke="#8d6e63" strokeWidth={0.03} />
            <line x1="0" y1="0" x2="0" y2="0.2" stroke="#8d6e63" strokeWidth={0.02} />
            <line x1="0.25" y1="0.2" x2="0.25" y2="0.4" stroke="#8d6e63" strokeWidth={0.02} />
            <line x1="0.5" y1="0" x2="0.5" y2="0.2" stroke="#8d6e63" strokeWidth={0.02} />
          </pattern>
        </defs>

        <g transform={`translate(${pan.x},${pan.y}) scale(${scale})`}>
          {/* 展厅外底色 */}
          <rect
            x={-1.2}
            y={-1.2}
            width={HALL_WIDTH + 2.4}
            height={HALL_HEIGHT + 2.4}
            rx={0.15}
            fill="#cdd4de"
          />
          <rect
            x={0}
            y={0}
            width={HALL_WIDTH}
            height={HALL_HEIGHT}
            fill="#fcfdfe"
            onPointerDown={startPan}
            onDoubleClick={onDoubleClick}
            onClick={onBackgroundClick}
          />

          <Grid u={u} />

          {/* 疏散路径（展位下层） */}
          {showPaths &&
            booths.map((b) => {
              const path = analysis.paths[b.id];
              if (!path || path.length < 2) return null;
              const strong = b.id === selectedId;
              return (
                <polyline
                  key={`path-${b.id}`}
                  points={path.map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none"
                  stroke="#15803d"
                  strokeWidth={(strong ? 3.4 : 2) * u}
                  strokeDasharray={`${0.28} ${0.2}`}
                  opacity={strong ? 0.95 : selectedId ? 0.18 : 0.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pointerEvents="none"
                />
              );
            })}

          {/* 重叠区域红斜纹 */}
          {overlapRegions.map((r, i) => (
            <rect
              key={`ov-${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              fill="url(#hatch-red)"
              stroke="#b91c1c"
              strokeWidth={1.2 * u}
              pointerEvents="none"
            />
          ))}

          {/* 墙体与出口 */}
          <Walls u={u} blockedExitIds={analysis.blockedExitIds} />

          {/* 展位 */}
          {booths.map((b) => (
            <BoothView
              key={b.id}
              booth={b}
              u={u}
              fs={fs}
              selected={b.id === selectedId}
              alerts={analysis.alerts.filter(
                (a) =>
                  a.boothId === b.id || a.relatedBoothId === b.id,
              )}
              emphasized={activeBoothIds.has(b.id)}
              reachable={(analysis.paths[b.id]?.length ?? 0) > 0}
              onPointerDown={(e) => startBoothDrag(e, b)}
              onHandleDown={(e, h) => startResize(e, b, h)}
              onRotate={() => planner.rotateBooth(b.id)}
              onAlertClick={(a) => {
                planner.selectBooth(b.id);
                onActiveAlertChange(a.id);
              }}
            />
          ))}

          {/* 净空尺寸标注 */}
          {clearanceMarks.map((m, i) => (
            <DimensionMark key={`dm-${i}`} m={m} u={u} fs={fs} />
          ))}

          {/* 尺寸标尺 */}
          <Rulers />
        </g>
      </svg>

      <ZoomControls
        onZoomIn={() => zoomBy(1.2)}
        onZoomOut={() => zoomBy(1 / 1.2)}
        onFit={fit}
        zoomText={`${Math.round((scale / baseScaleRef.current) * 100)}%`}
      />
    </>
  );
}

/* ================= 网格 ================= */

function Grid({ u }: { u: number }) {
  const lines: React.ReactNode[] = [];
  for (let x = 0; x <= HALL_WIDTH / GRID_SIZE; x++) {
    const v = x * GRID_SIZE;
    const major = x % 2 === 0;
    lines.push(
      <line
        key={`gx-${x}`}
        x1={v}
        y1={0}
        x2={v}
        y2={HALL_HEIGHT}
        stroke={major ? '#d3dae4' : '#e8edf3'}
        strokeWidth={(major ? 1 : 0.6) * u}
      />,
    );
  }
  for (let y = 0; y <= HALL_HEIGHT / GRID_SIZE; y++) {
    const v = y * GRID_SIZE;
    const major = y % 2 === 0;
    lines.push(
      <line
        key={`gy-${y}`}
        x1={0}
        y1={v}
        x2={HALL_WIDTH}
        y2={v}
        stroke={major ? '#d3dae4' : '#e8edf3'}
        strokeWidth={(major ? 1 : 0.6) * u}
      />,
    );
  }
  return <g pointerEvents="none">{lines}</g>;
}

/* ================= 墙体与出口 ================= */

function Walls({
  u,
  blockedExitIds,
}: {
  u: number;
  blockedExitIds: string[];
}) {
  const t = 0.22; // 墙厚（米）
  const wallColor = '#475569';

  // 每面墙被出口切成若干段
  const segments = wallSegments();

  return (
    <g>
      {segments.map((s, i) => (
        <rect
          key={`wall-${i}`}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill={wallColor}
        />
      ))}

      {EXITS.map((exitDef) => {
        const blocked = blockedExitIds.includes(exitDef.id);
        const horizontal = exitDef.wall === 'north' || exitDef.wall === 'south';
        const mid = (exitDef.start + exitDef.end) / 2;
        const len = exitDef.end - exitDef.start;
        const inset = 0.32;
        let x = 0;
        let y = 0;
        if (exitDef.wall === 'south') {
          x = exitDef.start;
          y = HALL_HEIGHT - t / 2;
        } else if (exitDef.wall === 'north') {
          x = exitDef.start;
          y = -t / 2;
        } else if (exitDef.wall === 'east') {
          x = HALL_WIDTH - t / 2;
          y = exitDef.start;
        } else {
          x = -t / 2;
          y = exitDef.start;
        }
        // 标签与（封堵时的）红叉放在墙外，避免与堵住开口的展位文字重叠
        const labelX = horizontal
          ? mid
          : x + (exitDef.wall === 'east' ? 0.78 : -0.78);
        const labelY = horizontal
          ? exitDef.wall === 'south'
            ? HALL_HEIGHT + 0.78
            : -0.78
          : mid;
        const color = blocked ? '#b91c1c' : '#15803d';

        return (
          <g key={exitDef.id}>
            {/* 出口内侧绿色/红色地带 */}
            {horizontal ? (
              <rect
                x={x}
                y={exitDef.wall === 'south' ? HALL_HEIGHT - inset : 0}
                width={len}
                height={inset}
                fill={blocked ? 'rgba(185,28,28,0.22)' : 'rgba(21,128,61,0.18)'}
              />
            ) : (
              <rect
                x={exitDef.wall === 'east' ? HALL_WIDTH - inset : 0}
                y={y}
                width={inset}
                height={len}
                fill={blocked ? 'rgba(185,28,28,0.22)' : 'rgba(21,128,61,0.18)'}
              />
            )}
            {/* 出口边框 */}
            {horizontal ? (
              <>
                <line x1={x} y1={exitDef.wall === 'south' ? HALL_HEIGHT : 0} x2={x} y2={(exitDef.wall === 'south' ? HALL_HEIGHT : 0) + (exitDef.wall === 'south' ? -inset : inset)} stroke={color} strokeWidth={2.4 * u} />
                <line x1={x + len} y1={exitDef.wall === 'south' ? HALL_HEIGHT : 0} x2={x + len} y2={(exitDef.wall === 'south' ? HALL_HEIGHT : 0) + (exitDef.wall === 'south' ? -inset : inset)} stroke={color} strokeWidth={2.4 * u} />
              </>
            ) : (
              <>
                <line x1={exitDef.wall === 'east' ? HALL_WIDTH : 0} y1={y} x2={(exitDef.wall === 'east' ? HALL_WIDTH : 0) + (exitDef.wall === 'east' ? -inset : inset)} y2={y} stroke={color} strokeWidth={2.4 * u} />
                <line x1={exitDef.wall === 'east' ? HALL_WIDTH : 0} y1={y + len} x2={(exitDef.wall === 'east' ? HALL_WIDTH : 0) + (exitDef.wall === 'east' ? -inset : inset)} y2={y + len} stroke={color} strokeWidth={2.4 * u} />
              </>
            )}
            {/* 标签底板 */}
            <g>
              <rect
                x={labelX - 0.62}
                y={labelY - 0.2}
                width={1.24}
                height={0.4}
                rx={0.06}
                fill={blocked ? '#b91c1c' : '#15803d'}
              />
              <text
                x={labelX}
                y={labelY + 0.06}
                textAnchor="middle"
                fontSize={0.26}
                fill="#fff"
                fontWeight={700}
              >
                {blocked ? '出口堵死' : '安全出口'}
              </text>
            </g>
            {blocked && (
              <g className="exit-cross">
                {/* 红叉画在墙外一侧 */}
                {horizontal ? (
                  <>
                    <line
                      x1={x + 0.2}
                      y1={exitDef.wall === 'south' ? HALL_HEIGHT + 0.06 : -0.06}
                      x2={x + len - 0.2}
                      y2={exitDef.wall === 'south' ? HALL_HEIGHT + 0.42 : -0.42}
                      stroke="#b91c1c"
                      strokeWidth={4 * u}
                      strokeLinecap="round"
                    />
                    <line
                      x1={x + 0.2}
                      y1={exitDef.wall === 'south' ? HALL_HEIGHT + 0.42 : -0.42}
                      x2={x + len - 0.2}
                      y2={exitDef.wall === 'south' ? HALL_HEIGHT + 0.06 : -0.06}
                      stroke="#b91c1c"
                      strokeWidth={4 * u}
                      strokeLinecap="round"
                    />
                  </>
                ) : (
                  <>
                    <line
                      x1={exitDef.wall === 'east' ? HALL_WIDTH + 0.06 : -0.06}
                      y1={y + 0.2}
                      x2={exitDef.wall === 'east' ? HALL_WIDTH + 0.42 : -0.42}
                      y2={y + len - 0.2}
                      stroke="#b91c1c"
                      strokeWidth={4 * u}
                      strokeLinecap="round"
                    />
                    <line
                      x1={exitDef.wall === 'east' ? HALL_WIDTH + 0.06 : -0.06}
                      y1={y + len - 0.2}
                      x2={exitDef.wall === 'east' ? HALL_WIDTH + 0.42 : -0.42}
                      y2={y + 0.2}
                      stroke="#b91c1c"
                      strokeWidth={4 * u}
                      strokeLinecap="round"
                    />
                  </>
                )}
              </g>
            )}
          </g>
        );
      })}

      {/* 大厅总尺寸标注 */}
      <text x={HALL_WIDTH / 2} y={-0.55} textAnchor="middle" fontSize={0.3} fill="#64748b">
        展厅 20 m
      </text>
      <text
        x={-0.75}
        y={HALL_HEIGHT / 2}
        textAnchor="middle"
        fontSize={0.3}
        fill="#64748b"
        transform={`rotate(-90 ${-0.75} ${HALL_HEIGHT / 2})`}
      >
        14 m
      </text>
    </g>
  );
}

function wallSegments(): { x: number; y: number; w: number; h: number }[] {
  const t = 0.22;
  const h = t / 2;
  const segs: { x: number; y: number; w: number; h: number }[] = [];
  const cuts = (wall: 'north' | 'south') => {
    const gaps = EXITS.filter((e) => e.wall === wall)
      .map((e) => [e.start, e.end])
      .sort((a, b) => a[0] - b[0]);
    let cursor = 0;
    const y = wall === 'north' ? -h : HALL_HEIGHT - h;
    for (const [s, e2] of gaps) {
      if (s > cursor) segs.push({ x: cursor, y, w: s - cursor, h: t });
      cursor = e2;
    }
    if (cursor < HALL_WIDTH)
      segs.push({ x: cursor, y, w: HALL_WIDTH - cursor, h: t });
  };
  cuts('north');
  cuts('south');
  // 东西墙完整
  segs.push({ x: -h, y: 0, w: t, h: HALL_HEIGHT });
  segs.push({ x: HALL_WIDTH - h, y: 0, w: t, h: HALL_HEIGHT });
  return segs;
}

/* ================= 展位 ================= */

const KIND_STYLE: Record<
  Alert['kind'],
  { color: string; char: string; title: string }
> = {
  overlap: { color: '#b91c1c', char: '重', title: '重叠' },
  'out-of-bounds': { color: '#b91c1c', char: '界', title: '越界' },
  clearance: { color: '#b45309', char: '距', title: '净空不足' },
  'exit-blocked': { color: '#b91c1c', char: '封', title: '封住出口' },
  'no-path': { color: '#6d28d9', char: '堵', title: '疏散不可达' },
};

interface BoothViewProps {
  booth: Booth;
  u: number;
  fs: number;
  selected: boolean;
  alerts: Alert[];
  emphasized: boolean;
  reachable: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onHandleDown: (e: React.PointerEvent, h: HandleId) => void;
  onRotate: () => void;
  onAlertClick: (a: Alert) => void;
}

function BoothView({
  booth: b,
  u,
  selected,
  alerts,
  emphasized,
  reachable,
  onPointerDown,
  onHandleDown,
  onRotate,
  onAlertClick,
}: BoothViewProps) {
  const isPartition = b.kind === 'partition';
  const [p1, p2] = frontEdge(b);
  const recv = receptionPoint(b);
  // 去重告警类型，同类型只显示一个徽标
  const badgeAlerts = alerts.filter(
    (a, i, arr) => arr.findIndex((x) => x.kind === a.kind) === i,
  );

  return (
    <g>
      {/* 围挡斜纹底 */}
      {isPartition && (
        <rect
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          fill="url(#hatch-partition)"
          pointerEvents="none"
        />
      )}
      {/* 主体 */}
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={0.06}
        fill={isPartition ? '#a1887f' : b.color}
        fillOpacity={isPartition ? 0.92 : alerts.length ? 0.55 : 0.85}
        stroke={selected ? '#1d4ed8' : '#1f2937'}
        strokeWidth={(selected ? 2.6 : 1.4) * u}
        strokeDasharray={isPartition ? `${0.0} ${0.0}` : undefined}
        style={{ cursor: 'move' }}
        onPointerDown={onPointerDown}
      />

      {/* 正面：粗线 + 朝向小三角（围挡不画正面） */}
      {!isPartition && (
        <>
          <line
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke="#f8fafc"
            strokeWidth={3 * u}
            strokeLinecap="round"
            pointerEvents="none"
          />
          <FrontArrow b={b} u={u} />
        </>
      )}

      {/* 标签与尺寸 */}
      <text
        x={b.x + b.w / 2}
        y={b.y + b.h / 2 + (isPartition ? 0.04 : -0.05)}
        textAnchor="middle"
        fontSize={Math.min(
          isPartition ? 0.3 : 0.34,
          Math.max(0.2, (isPartition ? Math.max(b.w, b.h) : b.h) * 0.26),
        )}
        fill={isPartition ? '#4e342e' : '#fff'}
        fontWeight={700}
        pointerEvents="none"
        style={{ paintOrder: 'stroke' }}
        stroke={isPartition ? 'none' : 'rgba(0,0,0,0.25)'}
        strokeWidth={0.04}
        transform={
          isPartition && b.h > b.w
            ? `rotate(-90 ${b.x + b.w / 2} ${b.y + b.h / 2})`
            : undefined
        }
      >
        {b.label}
        {isPartition ? '（围挡）' : ''}
      </text>
      {!isPartition && (
        <text
          x={b.x + b.w / 2}
          y={b.y + b.h / 2 + 0.3}
          textAnchor="middle"
          fontSize={0.2}
          fill="rgba(255,255,255,0.92)"
          pointerEvents="none"
        >
          {b.w}×{b.h} m · 正面{orientText(b.orientation)}
        </text>
      )}

      {/* 接待点（围挡没有接待点） */}
      {!isPartition && (
        <>
          <circle
            cx={recv.x}
            cy={recv.y}
            r={0.1}
            fill="#fff"
            stroke={reachable ? '#15803d' : '#6d28d9'}
            strokeWidth={2 * u}
            pointerEvents="none"
          />
          {!reachable && (
            <g pointerEvents="none">
              <line x1={recv.x - 0.09} y1={recv.y - 0.09} x2={recv.x + 0.09} y2={recv.y + 0.09} stroke="#6d28d9" strokeWidth={2.2 * u} />
              <line x1={recv.x + 0.09} y1={recv.y - 0.09} x2={recv.x - 0.09} y2={recv.y + 0.09} stroke="#6d28d9" strokeWidth={2.2 * u} />
            </g>
          )}
        </>
      )}

      {/* 告警描边（每种类型一层虚线，形状/颜色双重区分） */}
      {badgeAlerts.map((a) => (
        <rect
          key={a.id}
          x={b.x}
          y={b.y}
          width={b.w}
          height={b.h}
          rx={0.06}
          fill="none"
          stroke={KIND_STYLE[a.kind].color}
          strokeWidth={(emphasized ? 4 : 2.2) * u}
          strokeDasharray={
            a.kind === 'clearance'
              ? `${0.18} ${0.12}`
              : a.kind === 'no-path'
                ? `${0.06} ${0.1}`
                : `${0.3} ${0.14}`
          }
          className={emphasized ? 'alert-pulse' : undefined}
          pointerEvents="none"
        />
      ))}

      {/* 告警字符徽标（不只靠颜色表达） */}
      <g>
        {badgeAlerts.map((a, i) => {
          const st = KIND_STYLE[a.kind];
          const bx = b.x + 0.18 + i * 0.34;
          const by = b.y - 0.18;
          return (
            <g
              key={`badge-${a.id}`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onAlertClick(a);
              }}
            >
              <circle cx={bx} cy={by} r={0.15} fill={st.color} stroke="#fff" strokeWidth={1.4 * u} />
              <text x={bx} y={by + 0.065} textAnchor="middle" fontSize={0.19} fill="#fff" fontWeight={700}>
                {st.char}
              </text>
              <title>{`${st.title}：${a.message}`}</title>
            </g>
          );
        })}
      </g>

      {/* 选中：8 手柄 + 旋转钮 */}
      {selected && (
        <g pointerEvents="none">
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map(
            (h) => {
              const p = handlePos(b, h);
              return (
                <rect
                  key={h}
                  x={p.x - 0.11}
                  y={p.y - 0.11}
                  width={0.22}
                  height={0.22}
                  rx={0.03}
                  fill="#fff"
                  stroke="#1d4ed8"
                  strokeWidth={1.8 * u}
                  pointerEvents="all"
                  style={{ cursor: handleCursor(h), touchAction: 'none' }}
                  onPointerDown={(e) => onHandleDown(e, h)}
                />
              );
            },
          )}
          {/* 放大的隐形热区 */}
          {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map(
            (h) => {
              const p = handlePos(b, h);
              return (
                <rect
                  key={`hit-${h}`}
                  x={p.x - 0.2}
                  y={p.y - 0.2}
                  width={0.4}
                  height={0.4}
                  fill="transparent"
                  pointerEvents="all"
                  style={{ cursor: handleCursor(h), touchAction: 'none' }}
                  onPointerDown={(e) => onHandleDown(e, h)}
                />
              );
            },
          )}
          <circle
            cx={b.x + b.w / 2}
            cy={b.y - 0.55}
            r={0.16}
            fill="#1d4ed8"
            pointerEvents="all"
            style={{ cursor: 'pointer' }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRotate();
            }}
          />
          <text
            x={b.x + b.w / 2}
            y={b.y - 0.49}
            textAnchor="middle"
            fontSize={0.2}
            fill="#fff"
            fontWeight={700}
            pointerEvents="none"
          >
            ⟳
          </text>
          <line
            x1={b.x + b.w / 2}
            y1={b.y - 0.38}
            x2={b.x + b.w / 2}
            y2={b.y - 0.05}
            stroke="#1d4ed8"
            strokeWidth={1.4 * u}
          />
        </g>
      )}
    </g>
  );
}

function orientText(o: Booth['orientation']): string {
  return (
    { north: '朝北', east: '朝东', south: '朝南', west: '朝西' } as const
  )[o];
}

function FrontArrow({ b, u }: { b: Booth; u: number }) {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const s = 0.13;
  let tip: Point;
  let base1: Point;
  let base2: Point;
  switch (b.orientation) {
    case 'north':
      tip = { x: cx, y: b.y - 0.16 };
      base1 = { x: cx - s, y: b.y - 0.02 };
      base2 = { x: cx + s, y: b.y - 0.02 };
      break;
    case 'south':
      tip = { x: cx, y: b.y + b.h + 0.16 };
      base1 = { x: cx - s, y: b.y + b.h + 0.02 };
      base2 = { x: cx + s, y: b.y + b.h + 0.02 };
      break;
    case 'west':
      tip = { x: b.x - 0.16, y: cy };
      base1 = { x: b.x - 0.02, y: cy - s };
      base2 = { x: b.x - 0.02, y: cy + s };
      break;
    case 'east':
      tip = { x: b.x + b.w + 0.16, y: cy };
      base1 = { x: b.x + b.w + 0.02, y: cy - s };
      base2 = { x: b.x + b.w + 0.02, y: cy + s };
      break;
  }
  return (
    <polygon
      points={`${tip.x},${tip.y} ${base1.x},${base1.y} ${base2.x},${base2.y}`}
      fill="#f8fafc"
      stroke="#0f172a"
      strokeWidth={0.8 * u}
      pointerEvents="none"
    />
  );
}

function handlePos(b: Booth, h: HandleId): Point {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  switch (h) {
    case 'nw':
      return { x: b.x, y: b.y };
    case 'n':
      return { x: cx, y: b.y };
    case 'ne':
      return { x: b.x + b.w, y: b.y };
    case 'e':
      return { x: b.x + b.w, y: cy };
    case 'se':
      return { x: b.x + b.w, y: b.y + b.h };
    case 's':
      return { x: cx, y: b.y + b.h };
    case 'sw':
      return { x: b.x, y: b.y + b.h };
    case 'w':
      return { x: b.x, y: cy };
  }
}

function handleCursor(h: HandleId): string {
  if (h === 'n' || h === 's') return 'ns-resize';
  if (h === 'e' || h === 'w') return 'ew-resize';
  if (h === 'nw' || h === 'se') return 'nwse-resize';
  return 'nesw-resize';
}

/* ================= 缩放手柄几何 ================= */

function applyHandle(
  start: { x: number; y: number; w: number; h: number },
  handle: HandleId,
  worldX: number,
  worldY: number,
): Partial<Booth> {
  const px = snapToGrid(worldX);
  const py = snapToGrid(worldY);
  let { x, y, w, h } = start;

  if (handle.includes('e')) {
    w = snapResize(px - start.x);
  }
  if (handle.includes('w')) {
    const left = Math.min(px, start.x + start.w - MIN_SIZE);
    w = snapResize(start.x + start.w - left);
    x = snapToGrid(start.x + start.w - w);
  }
  if (handle.includes('s')) {
    h = snapResize(py - start.y);
  }
  if (handle.includes('n')) {
    const top = Math.min(py, start.y + start.h - MIN_SIZE);
    h = snapResize(start.y + start.h - top);
    y = snapToGrid(start.y + start.h - h);
  }
  return { x, y, w, h };
}

/* ================= 几何辅助 ================= */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function intersectionRect(a: Rect, b: Rect): Rect | null {
  if (!intersects(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    w: Math.min(a.x + a.w, b.x + b.w) - x,
    h: Math.min(a.y + a.h, b.y + b.h) - y,
  };
}

interface ClearanceMark {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label: string;
}

function clearanceDimension(a: Booth, b: Booth): ClearanceMark | null {
  const ra = rectOf(a);
  const rb = rectOf(b);
  const gapX = Math.max(rb.x - (ra.x + ra.w), ra.x - (rb.x + rb.w));
  const gapY = Math.max(rb.y - (ra.y + ra.h), ra.y - (rb.y + rb.h));
  if (gapX > 0 && gapY <= 0) {
    const left = ra.x < rb.x ? ra : rb;
    const right = ra.x < rb.x ? rb : ra;
    const cy =
      (Math.max(ra.y, rb.y) + Math.min(ra.y + ra.h, rb.y + rb.h)) / 2;
    return {
      x1: left.x + left.w,
      y1: cy,
      x2: right.x,
      y2: cy,
      label: `${Math.round(gapX * 100) / 100} m`,
    };
  }
  if (gapY > 0 && gapX <= 0) {
    const top = ra.y < rb.y ? ra : rb;
    const bottom = ra.y < rb.y ? rb : ra;
    const cx =
      (Math.max(ra.x, rb.x) + Math.min(ra.x + ra.w, rb.x + rb.w)) / 2;
    return {
      x1: cx,
      y1: top.y + top.h,
      x2: cx,
      y2: bottom.y,
      label: `${Math.round(gapY * 100) / 100} m`,
    };
  }
  return null;
}

function DimensionMark({
  m,
  u,
}: {
  m: ClearanceMark;
  u: number;
  fs: number;
}) {
  const midX = (m.x1 + m.x2) / 2;
  const midY = (m.y1 + m.y2) / 2;
  const horizontal = m.y1 === m.y2;
  return (
    <g pointerEvents="none">
      <line
        x1={m.x1}
        y1={m.y1}
        x2={m.x2}
        y2={m.y2}
        stroke="#b45309"
        strokeWidth={1.6 * u}
        markerStart="url(#none)"
      />
      <circle cx={m.x1} cy={m.y1} r={0.06} fill="#b45309" />
      <circle cx={m.x2} cy={m.y2} r={0.06} fill="#b45309" />
      <rect
        x={midX - 0.3}
        y={midY - 0.16}
        width={0.6}
        height={0.3}
        rx={0.04}
        fill="#fff7ed"
        stroke="#f59e0b"
        strokeWidth={u}
      />
      <text
        x={midX}
        y={midY + 0.05}
        textAnchor="middle"
        fontSize={0.2}
        fill="#92400e"
        fontWeight={700}
      >
        {m.label}
      </text>
      {horizontal ? (
        <>
          <line x1={m.x1} y1={m.y1 - 0.1} x2={m.x1} y2={m.y1 + 0.1} stroke="#b45309" strokeWidth={1.4 * u} />
          <line x1={m.x2} y1={m.y2 - 0.1} x2={m.x2} y2={m.y2 + 0.1} stroke="#b45309" strokeWidth={1.4 * u} />
        </>
      ) : (
        <>
          <line x1={m.x1 - 0.1} y1={m.y1} x2={m.x1 + 0.1} y2={m.y1} stroke="#b45309" strokeWidth={1.4 * u} />
          <line x1={m.x2 - 0.1} y1={m.y2} x2={m.x2 + 0.1} y2={m.y2} stroke="#b45309" strokeWidth={1.4 * u} />
        </>
      )}
    </g>
  );
}

/* ================= 标尺 ================= */

function Rulers() {
  const items: React.ReactNode[] = [];
  for (let x = 1; x < HALL_WIDTH; x++) {
    items.push(
      <text key={`rx-${x}`} x={x} y={0.22} fontSize={0.18} fill="#94a3b8" textAnchor="middle">
        {x}
      </text>,
    );
  }
  for (let y = 1; y < HALL_HEIGHT; y++) {
    items.push(
      <text key={`ry-${y}`} x={0.12} y={y + 0.06} fontSize={0.18} fill="#94a3b8">
        {y}
      </text>,
    );
  }
  return <g pointerEvents="none">{items}</g>;
}

/* ================= 缩放控件 ================= */

function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  zoomText,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  zoomText: string;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        bottom: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <button className="tb" style={{ width: 40, justifyContent: 'center', padding: 0 }} onClick={onZoomIn} title="放大">
        ＋
      </button>
      <button className="tb" style={{ width: 40, justifyContent: 'center', padding: 0 }} onClick={onZoomOut} title="缩小">
        －
      </button>
      <button className="tb" style={{ width: 40, justifyContent: 'center', padding: 0, fontSize: 11 }} onClick={onFit} title="适应窗口">
        {zoomText}
      </button>
    </div>
  );
}
