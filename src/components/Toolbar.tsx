interface ToolbarProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddBooth: () => void;
  onReset: (target: 'empty' | 'blocked-exit') => void;
  showPaths: boolean;
  onTogglePaths: () => void;
}

export function Toolbar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAddBooth,
  onReset,
  showPaths,
  onTogglePaths,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="brand">
        <span className="logo">展</span>
        <span>展位排布工作台</span>
        <small>20 × 14 m 展厅 · 0.5 m 网格</small>
      </div>

      <div className="tb-group">
        <button className="tb primary" onClick={onAddBooth}>
          ＋ 添加展位
        </button>
      </div>

      <div className="tb-group">
        <button className="tb" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)">
          ↶ 撤销 <span className="k">Ctrl+Z</span>
        </button>
        <button className="tb" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Y)">
          ↷ 重做 <span className="k">Ctrl+Y</span>
        </button>
      </div>

      <div className="tb-group">
        <button
          className="tb"
          onClick={onTogglePaths}
          title="显示/隐藏疏散路径"
        >
          {showPaths ? '🚧 隐藏路径' : '🚶 显示路径'}
        </button>
        <button
          className="tb"
          onClick={() => onReset('blocked-exit')}
          title="载入内置的出口被堵示例方案"
        >
          载入“出口被堵”示例
        </button>
        <button
          className="tb danger-text"
          onClick={() => {
            if (window.confirm('确定清空全部展位？此操作可用撤销恢复。')) {
              onReset('empty');
            }
          }}
        >
          方案重置
        </button>
      </div>

      <div className="tb-spacer" />
      <div className="tb-group">
        <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
          数据保存在本机浏览器
        </span>
      </div>
    </header>
  );
}
