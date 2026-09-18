import type { Alert } from '../types';

const KIND_META: Record<
  Alert['kind'],
  { char: string; title: string; cls: string }
> = {
  'exit-blocked': { char: '封', title: '出口被堵', cls: 'kind-exit-blocked' },
  overlap: { char: '重', title: '展位重叠', cls: 'kind-overlap' },
  'out-of-bounds': { char: '界', title: '超出展厅', cls: 'kind-out-of-bounds' },
  clearance: { char: '距', title: '通道过窄', cls: 'kind-clearance' },
  'no-path': { char: '堵', title: '疏散不可达', cls: 'kind-no-path' },
};

// 严重度排序：出口封堵 > 重叠/越界 > 不可达 > 净空
const ORDER: Alert['kind'][] = [
  'exit-blocked',
  'overlap',
  'out-of-bounds',
  'no-path',
  'clearance',
];

interface AlertPanelProps {
  alerts: Alert[];
  activeAlertId: string | null;
  onSelect: (a: Alert) => void;
}

export function AlertPanel({ alerts, activeAlertId, onSelect }: AlertPanelProps) {
  const sorted = [...alerts].sort(
    (a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
  );

  return (
    <div className="sidebar-section" style={{ flex: '1 1 50%' }}>
      <div className="section-head">
        实时检查
        <span className={`count ${alerts.length ? 'bad' : 'zero'}`}>
          {alerts.length} 条
        </span>
      </div>
      <div className="alert-list">
        {sorted.length === 0 ? (
          <div className="empty-alerts">
            ✓ 全部检查通过
            <br />
            无越界、重叠、净空或疏散问题
          </div>
        ) : (
          sorted.map((a) => {
            const meta = KIND_META[a.kind];
            return (
              <button
                key={a.id}
                className={`alert-card ${meta.cls} ${
                  activeAlertId === a.id ? 'active' : ''
                }`}
                onClick={() => onSelect(a)}
              >
                <span className={`icon ${meta.cls}`}>{meta.char}</span>
                <span className="body">
                  <span className="title">{meta.title}</span>
                  <span className="msg" style={{ display: 'block' }}>
                    {a.message}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
