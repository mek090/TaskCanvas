import type { Mode } from '../lib/types';

type Props = {
  isTrashView: boolean;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  status: string;
  showEmptyTrash: boolean;
  onEmptyTrash: () => void;
  onExport: () => void;
  onImport: () => void;
};

export function Topbar({
  isTrashView,
  mode,
  onModeChange,
  status,
  showEmptyTrash,
  onEmptyTrash,
  onExport,
  onImport,
}: Props) {
  const title = isTrashView ? 'Trash' : mode === 'canvas' ? 'Canvas Board' : 'List Mode';
  return (
    <header className="topbar">
      <div>
        <h2>{title}</h2>
        <p className="status">
          <span
            className={`status-dot ${/fail|error/i.test(status) ? 'error' : ''}`}
            aria-hidden="true"
          />
          {status}
        </p>
      </div>
      <div className="actions">
        <button className={mode === 'canvas' ? 'active' : ''} onClick={() => onModeChange('canvas')}>
          Canvas
        </button>
        <button className={mode === 'list' ? 'active' : ''} onClick={() => onModeChange('list')}>
          List
        </button>
        <span className="divider" aria-hidden="true" />
        {showEmptyTrash && (
          <button className="danger" onClick={onEmptyTrash}>
            Empty trash
          </button>
        )}
        <button onClick={onExport}>Export</button>
        <button onClick={onImport}>Import</button>
      </div>
    </header>
  );
}
