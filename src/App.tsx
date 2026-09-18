import { useState } from 'react';
import { usePlanner } from './state/usePlanner';
import { Toolbar } from './components/Toolbar';
import { FloorPlan } from './components/FloorPlan';
import { AlertPanel } from './components/AlertPanel';
import { Inspector } from './components/Inspector';
import type { Alert } from './types';

export default function App() {
  const planner = usePlanner();
  const [activeAlertId, setActiveAlertId] = useState<string | null>(null);
  const [showPaths, setShowPaths] = useState(true);
  const [zoom, setZoom] = useState(1);

  const focusAlert = (alert: Alert) => {
    setActiveAlertId(alert.id);
    planner.selectBooth(alert.boothId);
  };

  const alertCount = planner.analysis.alerts.length;

  return (
    <div className="app">
      <Toolbar
        canUndo={planner.canUndo}
        canRedo={planner.canRedo}
        onUndo={planner.undo}
        onRedo={planner.redo}
        onAddBooth={planner.addBooth}
        onReset={planner.resetPlan}
        showPaths={showPaths}
        onTogglePaths={() => setShowPaths((v) => !v)}
      />

      <div className="workspace">
        <div className="canvas-wrap">
          <FloorPlan
            planner={planner}
            showPaths={showPaths}
            activeAlertId={activeAlertId}
            onActiveAlertChange={setActiveAlertId}
            onZoomChange={setZoom}
          />
          <div className="hint-chip">
            双击空白添加展位 · 拖动移动 · 手柄缩放 · <b>R</b> 旋转 ·
            滚轮缩放 · 拖空白平移
          </div>
          <Legend />
        </div>

        <div className="sidebar">
          <AlertPanel
            alerts={planner.analysis.alerts}
            activeAlertId={activeAlertId}
            onSelect={focusAlert}
          />
          <Inspector planner={planner} onAlertClick={focusAlert} />
        </div>
      </div>

      <footer className="statusbar">
        <span className="stat">展位 {planner.booths.length} 个</span>
        <span className="stat">
          <span
            className="dot"
            style={{ background: alertCount ? '#b91c1c' : '#15803d' }}
          />
          {alertCount === 0 ? '检查通过，无告警' : `${alertCount} 条告警待处理`}
        </span>
        <span className="stat">{Math.round(zoom * 100)}% 缩放</span>
        <span className="save-state">方案已自动保存到本地浏览器</span>
      </footer>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <div className="row">
        <span className="swatch exit" /> 安全出口（绿色开口）
      </div>
      <div className="row">
        <span className="swatch path" /> 疏散路径（至最近出口）
      </div>
      <div className="row">
        <span className="swatch overlap" /> 重叠 / 越界 / 出口封堵
      </div>
      <div className="row">
        <span className="swatch clearance" /> 净空不足 1.5 m
      </div>
      <div className="row">
        <span className="swatch nopath" /> 接待点不可达
      </div>
    </div>
  );
}
