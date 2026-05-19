import type { DragEvent, PointerEvent, RefObject } from 'react';
import type { Attachment, BoardItem, Todo } from '../lib/types';
import { priorityLabel } from '../lib/types';
import { dueLabel, isOverdue } from '../lib/dates';
import { EmptyState } from './EmptyState';
import { CanvasIcon, ClipboardIcon, ClockIcon, CloseIcon } from './Icon';

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
}: Props) {
  return (
    <div
      ref={canvasRef}
      className="canvas"
      onDrop={onDrop}
      onDragOver={(event) => event.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className={`drop-hint ${items.length > 0 ? 'dim' : ''}`}>
        <ClipboardIcon />
        Paste Ctrl+V or drop images · drag to arrange
      </div>
      {items.length === 0 && (
        <EmptyState icon={CanvasIcon} title="Your canvas is empty">
          Click <b>Board</b> on any sidebar task to pin it here, or paste/drop an image.
        </EmptyState>
      )}
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
            onPointerDown={(e) => onBeginDrag(e, item, 'move')}
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
                e.stopPropagation();
                onBeginDrag(e, item, 'resize');
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
