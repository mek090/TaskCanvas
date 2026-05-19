import type { Mode } from '../lib/types';
import { CanvasIcon, DownloadIcon, ListIcon, TrashIcon, UploadIcon } from './Icon';

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
  const title = isTrashView ? 'Trash' : mode === 'canvas' ? 'Canvas Board' : 'List View';
  const statusKind = /fail|error/i.test(status) ? 'error' : /saving|loading|loading|busy/i.test(status) ? 'busy' : '';
  return (
    <header className="topbar">
      <div className="topbar-left">
        <h2>{title}</h2>
        <span className={`status-chip ${statusKind}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {status}
        </span>
      </div>
      <div className="topbar-actions">
        {!isTrashView && (
          <div className="mode-switch" role="group" aria-label="View mode">
            <button
              type="button"
              className={mode === 'canvas' ? 'active' : ''}
              aria-pressed={mode === 'canvas'}
              onClick={() => onModeChange('canvas')}
            >
              <CanvasIcon />
              Canvas
            </button>
            <button
              type="button"
              className={mode === 'list' ? 'active' : ''}
              aria-pressed={mode === 'list'}
              onClick={() => onModeChange('list')}
            >
              <ListIcon />
              List
            </button>
          </div>
        )}
        {showEmptyTrash && (
          <button className="danger" onClick={onEmptyTrash} aria-label="Empty trash">
            <TrashIcon />
            <span style={{ marginLeft: 6 }}>Empty trash</span>
          </button>
        )}
        <span className="action-divider" aria-hidden="true" />
        <button className="icon" onClick={onExport} aria-label="Export backup" title="Export backup">
          <DownloadIcon />
        </button>
        <button className="icon" onClick={onImport} aria-label="Import backup" title="Import backup">
          <UploadIcon />
        </button>
      </div>
    </header>
  );
}
