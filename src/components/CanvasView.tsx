import type { DragEvent, PointerEvent, RefObject, WheelEvent } from 'react';
import type { Attachment, BoardItem, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue } from '../lib/dates';
import type { WorldBounds } from '../hooks/useCanvasPanZoom';
import { EmptyState } from './EmptyState';
import { CanvasIcon, ClipboardIcon, ClockIcon, CloseIcon } from './Icon';

type Bindings = {
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => boolean;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
};

type Props = {
  canvasRef: RefObject<HTMLDivElement | null>;
  items: BoardItem[];
  todoMap: Map<string, Todo>;
  attachmentMap: Map<string, Attachment>;
  imageUrls: Record<string, string>;
  onDrop: (event: DragEvent) => void;
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: () => void;
  onBeginDrag: (event: PointerEvent, item: BoardItem, mode: 'move' | 'resize') => void;
  onSelectTodo: (id: string) => void;
  onDeleteItem: (id: string) => void;
  transform: string;
  zoom: number;
  isSpaceDown: boolean;
  isPanning: boolean;
  canvasClass: string;
  panBindings: Bindings;
  onReset: () => void;
  worldBounds: WorldBounds;
};

export function CanvasView({
  canvasRef,
  items,
  todoMap,
  attachmentMap,
  imageUrls,
  onDrop,
  onPointerMove,
  onPointerUp,
  onBeginDrag,
  onSelectTodo,
  onDeleteItem,
  transform,
  zoom,
  isSpaceDown,
  isPanning,
  canvasClass,
  panBindings,
  onReset,
  worldBounds,
}: Props) {
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    panBindings.onPointerDown(event);
  };
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    panBindings.onPointerMove(event);
    onPointerMove(event);
  };
  const handlePointerUp = () => {
    panBindings.onPointerUp();
    onPointerUp();
  };
  const zoomPct = Math.round(zoom * 100);

  return (
    <div
      ref={canvasRef}
      className={`canvas ${canvasClass}`}
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={panBindings.onWheel}
    >
      <div className={`drop-hint ${items.length > 0 ? 'dim' : ''}`}>
        <ClipboardIcon />
        Paste Ctrl+V or drop images · Space + drag to pan · Ctrl + scroll to zoom
      </div>
      {items.length === 0 && (
        <EmptyState icon={CanvasIcon} title="Your canvas is empty">
          Click <b>Board</b> on any sidebar task to pin it here, or paste/drop an image.
        </EmptyState>
      )}
      <button
        className={`zoom-badge ${zoomPct === 100 ? '' : 'changed'}`}
        onClick={onReset}
        title="Reset zoom (Ctrl + 0)"
        type="button"
      >
        {zoomPct}%
      </button>
      <div
        className="canvas-stage"
        style={{ transform, transformOrigin: '0 0' }}
        data-pan-mode={isSpaceDown ? 'true' : undefined}
        data-panning={isPanning ? 'true' : undefined}
      >
        <div
          className="canvas-frame"
          style={{
            left: worldBounds.x,
            top: worldBounds.y,
            width: worldBounds.width,
            height: worldBounds.height,
          }}
          aria-hidden="true"
        >
          <span className="canvas-frame-label">
            Workspace · {Math.round(worldBounds.width)} × {Math.round(worldBounds.height)}
          </span>
        </div>
        {items.map((item) => {
          const style = {
            left: item.x,
            top: item.y,
            width: item.width,
            height: item.height,
            zIndex: item.z_index,
          };
          if (item.item_type === 'todo') {
            const todo = todoMap.get(item.ref_id);
            if (!todo) return null;
            return (
              <div
                className={`canvas-card todo-card prio-${todo.priority} ${todo.completed ? 'completed' : ''}`}
                style={style}
                key={item.id}
                onPointerDown={(e) => {
                  if (isSpaceDown) return;
                  onSelectTodo(todo.id);
                  onBeginDrag(e, item, 'move');
                }}
              >
                <div className="card-head">
                  <span className="priority-dot">{priorityLabel[todo.priority]}</span>
                  <button
                    className="card-close"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onDeleteItem(item.id)}
                    aria-label="Remove from canvas"
                  >
                    <CloseIcon />
                  </button>
                </div>
                <h3>{todo.title}</h3>
                <p>{todo.description}</p>
                <footer>
                  {todo.due_date && (
                    <b className={`due-pill ${isOverdue(todo) ? 'overdue' : ''}`}>
                      <ClockIcon />
                      {dueLabel(todo)}
                    </b>
                  )}
                  {todo.tags && <span className="chip">{todo.tags}</span>}
                  {!todo.due_date && !todo.tags && <span>No due date · untagged</span>}
                </footer>
                <span
                  className="resize"
                  onPointerDown={(e) => {
                    if (isSpaceDown) return;
                    e.stopPropagation();
                    onBeginDrag(e, item, 'resize');
                  }}
                />
              </div>
            );
          }
          const attachment = attachmentMap.get(item.ref_id);
          if (!attachment) return null;
          return (
            <div
              className="canvas-card image-card"
              style={style}
              key={item.id}
              onPointerDown={(e) => {
                if (isSpaceDown) return;
                onBeginDrag(e, item, 'move');
              }}
            >
              {imageUrls[attachment.id] ? (
                <img src={imageUrls[attachment.id]} alt={attachment.file_name} draggable={false} />
              ) : (
                <div className="image-loading">Loading image…</div>
              )}
              <div className="image-caption">
                <span>{attachment.file_name}</span>
                <button
                  className="card-close"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onDeleteItem(item.id)}
                  aria-label="Remove image"
                >
                  <CloseIcon />
                </button>
              </div>
              <span
                className="resize"
                onPointerDown={(e) => {
                  if (isSpaceDown) return;
                  e.stopPropagation();
                  onBeginDrag(e, item, 'resize');
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
