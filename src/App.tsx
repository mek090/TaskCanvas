import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { call, isTauri } from './lib/api';
import {
  compareTodosByDue,
  compareTodosByUpdated,
  normalizeDueDate,
} from './lib/dates';
import { fileToDataUrl, isTextEditingTarget } from './lib/files';
import type {
  Attachment,
  BoardItem,
  DragState,
  Mode,
  PurgeResult,
  SortMode,
  TaskFilter,
  Todo,
} from './lib/types';
import { useToast } from './hooks/useToast';
import { useConfirm } from './hooks/useConfirm';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { CanvasView } from './components/CanvasView';
import { ListView } from './components/ListView';
import { Inspector } from './components/Inspector';
import { ConfirmDialog } from './components/ConfirmDialog';
import { Toast } from './components/Toast';
import type { ComposerDraft } from './components/Composer';

const EMPTY_DRAFT: ComposerDraft = {
  title: '',
  description: '',
  priority: 'medium',
  due_date: '',
  tags: '',
};

export function App() {
  const [mode, setMode] = useState<Mode>('canvas');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [deletedTodos, setDeletedTodos] = useState<Todo[]>([]);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [sortMode, setSortMode] = useState<SortMode>('due');
  const [draft, setDraft] = useState<ComposerDraft>(EMPTY_DRAFT);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [drag, setDrag] = useState<DragState | null>(null);

  const { toast, showToast, dismissToast } = useToast();
  const { confirmRequest, requestConfirm, handleConfirm } = useConfirm();

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const latestDraggedItem = useRef<BoardItem | null>(null);
  const todosRef = useRef<Todo[]>([]);

  useEffect(() => {
    todosRef.current = todos;
  }, [todos]);

  const refresh = useCallback(async () => {
    await call('init_db');
    const [todoData, deletedTodoData, boardData, attachmentData] = await Promise.all([
      call<Todo[]>('list_todos'),
      call<Todo[]>('list_deleted_todos'),
      call<BoardItem[]>('list_board_items', { boardId: 'main' }),
      call<Attachment[]>('list_attachments', { boardId: 'main' }),
    ]);
    setTodos(todoData);
    setDeletedTodos(deletedTodoData);
    setItems(boardData);
    setAttachments(attachmentData);
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(String(error)));
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function loadImages() {
      const missing = attachments.filter((a) => !imageUrls[a.id]);
      if (missing.length === 0) return;
      const pairs = await Promise.all(
        missing.map(
          async (a) => [a.id, await call<string>('get_attachment_data_url', { id: a.id })] as const,
        ),
      );
      if (!cancelled) {
        setImageUrls((prev) => Object.fromEntries([...Object.entries(prev), ...pairs]));
      }
    }
    loadImages().catch((error) => setStatus(String(error)));
    return () => {
      cancelled = true;
    };
  }, [attachments, imageUrls]);

  const selectedTodo = useMemo(
    () => todos.find((todo) => todo.id === selectedTodoId) ?? null,
    [todos, selectedTodoId],
  );
  const todoMap = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const attachmentMap = useMemo(
    () => new Map(attachments.map((attachment) => [attachment.id, attachment])),
    [attachments],
  );

  const matchesQuery = useCallback(
    (todo: Todo) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${todo.title} ${todo.description} ${todo.tags}`.toLowerCase().includes(q);
    },
    [query],
  );

  const filteredTodos = useMemo(
    () =>
      todos
        .filter((todo) => {
          if (filter === 'trash') return false;
          if (filter === 'active' && todo.completed) return false;
          if (filter === 'due' && (todo.completed || !todo.due_date)) return false;
          if (filter === 'done' && !todo.completed) return false;
          return matchesQuery(todo);
        })
        .sort(sortMode === 'due' ? compareTodosByDue : compareTodosByUpdated),
    [todos, filter, matchesQuery, sortMode],
  );

  const filteredDeletedTodos = useMemo(
    () => deletedTodos.filter(matchesQuery),
    [deletedTodos, matchesQuery],
  );
  const isTrashView = filter === 'trash';

  const handleFilterChange = useCallback((next: TaskFilter) => {
    setFilter(next);
    if (next === 'trash') setMode('list');
  }, []);

  const createTodo = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!draft.title.trim()) return;
      try {
        const todo = await call<Todo>('create_todo', {
          input: { ...draft, due_date: normalizeDueDate(draft.due_date) },
        });
        await call<BoardItem>('upsert_board_item', {
          input: {
            item_type: 'todo',
            ref_id: todo.id,
            x: 80 + Math.random() * 180,
            y: 90 + Math.random() * 140,
            width: 280,
            height: 170,
            z_index: 3,
          },
        });
        setDraft(EMPTY_DRAFT);
        setSelectedTodoId(todo.id);
        setStatus('Created task and placed it on canvas');
        await refresh();
      } catch (err) {
        setStatus(`Create failed: ${String(err)}`);
      }
    },
    [draft, refresh],
  );

  const updateTodoField = useCallback(async (id: string, patch: Partial<Todo>) => {
    const current = todosRef.current.find((todo) => todo.id === id);
    if (!current) return;
    const next = { ...current, ...patch };
    try {
      const updated = await call<Todo>('update_todo', {
        input: {
          id: next.id,
          title: next.title,
          description: next.description,
          completed: next.completed,
          priority: next.priority,
          due_date: next.due_date,
          tags: next.tags,
        },
      });
      setTodos((prev) => prev.map((todo) => (todo.id === updated.id ? updated : todo)));
      setStatus('Saved');
    } catch (err) {
      setStatus(`Save failed: ${String(err)}`);
    }
  }, []);

  const toggleTodo = useCallback(async (todo: Todo) => {
    try {
      const updated = await call<Todo>('toggle_todo', { id: todo.id });
      setTodos((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    } catch (err) {
      setStatus(`Toggle failed: ${String(err)}`);
    }
  }, []);

  const restoreTodo = useCallback(
    async (id: string) => {
      try {
        const restored = await call<Todo>('restore_todo', { id });
        await refresh();
        setSelectedTodoId(restored.id);
        setFilter('all');
        setStatus('Task restored');
        dismissToast();
      } catch (err) {
        setStatus(`Restore failed: ${String(err)}`);
      }
    },
    [dismissToast, refresh],
  );

  const deleteTodo = useCallback(
    async (id: string) => {
      try {
        await call('delete_todo', { id });
        if (selectedTodoId === id) setSelectedTodoId(null);
        await refresh();
        setStatus('Task moved to trash');
        showToast('Task moved to trash', () => {
          void restoreTodo(id);
        });
      } catch (err) {
        setStatus(`Delete failed: ${String(err)}`);
      }
    },
    [refresh, restoreTodo, selectedTodoId, showToast],
  );

  const purgeTodo = useCallback(
    async (id: string, title: string) => {
      const ok = await requestConfirm({
        title: 'Permanently delete task?',
        message: `This will remove “${title}” from Trash, delete its canvas cards, and clean linked local attachments. This cannot be undone.`,
        confirmLabel: 'Delete forever',
      });
      if (!ok) return;
      try {
        const result = await call<PurgeResult>('purge_todo', { id });
        await refresh();
        setStatus(`Purged ${result.todos} task, ${result.attachments} attachment(s), ${result.image_files} file(s)`);
      } catch (err) {
        setStatus(`Purge failed: ${String(err)}`);
      }
    },
    [refresh, requestConfirm],
  );

  const emptyTrash = useCallback(async () => {
    if (deletedTodos.length === 0) {
      setStatus('Trash is already empty');
      return;
    }
    const ok = await requestConfirm({
      title: 'Empty trash?',
      message: `This will permanently delete ${deletedTodos.length} task(s), remove their canvas cards, and clean orphan attachments. This cannot be undone.`,
      confirmLabel: 'Empty trash',
    });
    if (!ok) return;
    try {
      const result = await call<PurgeResult>('purge_deleted_todos');
      await refresh();
      setSelectedTodoId(null);
      setStatus(
        `Emptied trash: ${result.todos} task(s), ${result.attachments} attachment(s), ${result.image_files} file(s)`,
      );
    } catch (err) {
      setStatus(`Empty trash failed: ${String(err)}`);
    }
  }, [deletedTodos.length, refresh, requestConfirm]);

  const placeExistingTodo = useCallback(
    async (todo: Todo) => {
      const already = items.some((item) => item.item_type === 'todo' && item.ref_id === todo.id);
      if (already) {
        setStatus('Task is already on canvas');
        return;
      }
      try {
        await call('upsert_board_item', {
          input: {
            item_type: 'todo',
            ref_id: todo.id,
            x: 120,
            y: 120,
            width: 280,
            height: 170,
            z_index: 4,
          },
        });
        setStatus('Placed task on canvas');
        await refresh();
      } catch (err) {
        setStatus(`Place failed: ${String(err)}`);
      }
    },
    [items, refresh],
  );

  const saveImage = useCallback(
    async (dataUrl: string, fileName?: string, point?: { x: number; y: number }) => {
      try {
        await call('save_image_data_url', {
          dataUrl,
          fileName,
          todoId: selectedTodoId,
          boardId: 'main',
          x: point?.x ?? 120,
          y: point?.y ?? 120,
        });
        setStatus('Image saved locally and added to canvas');
        await refresh();
      } catch (err) {
        setStatus(`Image save failed: ${String(err)}`);
      }
    },
    [refresh, selectedTodoId],
  );

  const handlePaste = useCallback(
    async (event: ClipboardEvent) => {
      if (isTextEditingTarget(event.target)) return;
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) =>
        item.type.startsWith('image/'),
      );
      if (!imageItem) return;
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        const canvas = canvasRef.current;
        const point = canvas
          ? {
              x: canvas.scrollLeft + canvas.clientWidth / 2 - 130,
              y: canvas.scrollTop + canvas.clientHeight / 2 - 90,
            }
          : { x: 150, y: 150 };
        await saveImage(dataUrl, `pasted-${Date.now()}.png`, point);
      } catch (err) {
        setStatus(`Paste failed: ${String(err)}`);
      }
    },
    [saveImage],
  );

  useEffect(() => {
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handlePaste]);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const point = rect && canvas
        ? {
            x: event.clientX - rect.left + canvas.scrollLeft,
            y: event.clientY - rect.top + canvas.scrollTop,
          }
        : { x: 140, y: 140 };
      const imageFiles = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/'),
      );
      for (const [index, file] of imageFiles.entries()) {
        try {
          const dataUrl = await fileToDataUrl(file);
          await saveImage(dataUrl, file.name, { x: point.x + index * 28, y: point.y + index * 28 });
        } catch (err) {
          setStatus(`Image dropped failed: ${String(err)}`);
        }
      }
    },
    [saveImage],
  );

  const beginDrag = useCallback(
    (event: React.PointerEvent, item: BoardItem, dragMode: 'move' | 'resize') => {
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      const topZ = Math.max(1, ...items.map((candidate) => candidate.z_index));
      const lifted = { ...item, z_index: topZ + 1 };
      latestDraggedItem.current = lifted;
      setItems((prev) => prev.map((candidate) => (candidate.id === item.id ? lifted : candidate)));
      setDrag({
        item: lifted,
        mode: dragMode,
        startX: event.clientX,
        startY: event.clientY,
        original: { ...lifted },
      });
    },
    [items],
  );

  const endDrag = useCallback(async () => {
    if (!drag) return;
    const latest =
      latestDraggedItem.current ?? items.find((item) => item.id === drag.item.id) ?? drag.item;
    setDrag(null);
    latestDraggedItem.current = null;
    try {
      const updated = await call<BoardItem>('upsert_board_item', {
        input: {
          id: latest.id,
          board_id: latest.board_id,
          item_type: latest.item_type,
          ref_id: latest.ref_id,
          x: latest.x,
          y: latest.y,
          width: latest.width,
          height: latest.height,
          z_index: latest.z_index,
        },
      });
      setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setStatus(`Save position failed: ${String(err)}`);
    }
  }, [drag, items]);

  const moveDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const nextDraggedItem =
        drag.mode === 'move'
          ? {
              ...drag.original,
              x: Math.max(-40, drag.original.x + dx),
              y: Math.max(-40, drag.original.y + dy),
            }
          : {
              ...drag.original,
              width: Math.max(160, drag.original.width + dx),
              height: Math.max(110, drag.original.height + dy),
            };
      latestDraggedItem.current = nextDraggedItem;
      setItems((prev) =>
        prev.map((item) => {
          if (item.id !== drag.item.id) return item;
          return nextDraggedItem;
        }),
      );
    },
    [drag],
  );

  const deleteCanvasItem = useCallback(
    async (id: string) => {
      const target = items.find((item) => item.id === id);
      if (!target) return;
      try {
        await call('delete_board_item', { id });
        setItems((prev) => prev.filter((item) => item.id !== id));
        setStatus('Item removed from canvas');
        showToast('Item removed', async () => {
          try {
            const restored = await call<BoardItem>('upsert_board_item', {
              input: {
                id: target.id,
                board_id: target.board_id,
                item_type: target.item_type,
                ref_id: target.ref_id,
                x: target.x,
                y: target.y,
                width: target.width,
                height: target.height,
                z_index: target.z_index,
              },
            });
            setItems((prev) =>
              prev.some((item) => item.id === restored.id)
                ? prev.map((item) => (item.id === restored.id ? restored : item))
                : [...prev, restored],
            );
            dismissToast();
            setStatus('Item restored to canvas');
          } catch (err) {
            setStatus(`Restore failed: ${String(err)}`);
          }
        });
      } catch (err) {
        setStatus(`Remove failed: ${String(err)}`);
      }
    },
    [dismissToast, items, showToast],
  );

  const exportBackup = useCallback(async () => {
    if (!isTauri) {
      try {
        const snapshot = await call<string>('export_snapshot');
        await navigator.clipboard.writeText(snapshot);
        setStatus('Web demo: snapshot JSON copied to clipboard');
      } catch (err) {
        setStatus(`Export failed: ${String(err)}`);
      }
      return;
    }
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const path = await saveDialog({
        defaultPath: `taskcanvas-backup-${stamp}.taskcanvas.zip`,
        filters: [{ name: 'TaskCanvas Backup', extensions: ['taskcanvas.zip', 'zip'] }],
      });
      if (!path) {
        setStatus('Export canceled');
        return;
      }
      await call('export_backup', { targetPath: path });
      setStatus(`Backup saved: ${path}`);
    } catch (err) {
      setStatus(`Export failed: ${String(err)}`);
    }
  }, []);

  const importBackup = useCallback(async () => {
    if (!isTauri) {
      setStatus('Import is desktop-only');
      return;
    }
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: 'TaskCanvas Backup', extensions: ['taskcanvas.zip', 'zip'] }],
      });
      if (!selected || Array.isArray(selected)) {
        setStatus('Import canceled');
        return;
      }
      const proceed = await requestConfirm({
        title: 'Replace all data?',
        message:
          'Importing will REPLACE all current tasks, board items, and images. Your current database will be backed up automatically before import.',
        confirmLabel: 'Replace and Import',
        cancelLabel: 'Cancel',
      });
      if (!proceed) {
        setStatus('Import canceled');
        return;
      }
      const result = await call<{
        todos: number;
        board_items: number;
        attachments: number;
        images: number;
        backup_path: string;
      }>('import_backup', { sourcePath: selected });
      setImageUrls({});
      await refresh();
      setStatus(
        `Imported ${result.todos} tasks, ${result.board_items} canvas items, ${result.images} images. Previous DB → ${result.backup_path}`,
      );
    } catch (err) {
      setStatus(`Import failed: ${String(err)}`);
    }
  }, [refresh, requestConfirm]);

  return (
    <main className="app-shell">
      <Sidebar
        draft={draft}
        onDraftChange={setDraft}
        onCreate={createTodo}
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={handleFilterChange}
        sortMode={sortMode}
        onSortChange={setSortMode}
        isTrashView={isTrashView}
        todos={todos}
        filteredTodos={filteredTodos}
        filteredDeletedTodos={filteredDeletedTodos}
        deletedCount={deletedTodos.length}
        selectedTodoId={selectedTodoId}
        onSelectTodo={setSelectedTodoId}
        onToggleTodo={toggleTodo}
        onPlaceOnBoard={placeExistingTodo}
        onRestore={restoreTodo}
        onPurge={purgeTodo}
      />

      <section className="workspace">
        <Topbar
          isTrashView={isTrashView}
          mode={mode}
          onModeChange={setMode}
          status={status}
          showEmptyTrash={isTrashView}
          onEmptyTrash={emptyTrash}
          onExport={exportBackup}
          onImport={importBackup}
        />

        {mode === 'canvas' ? (
          <CanvasView
            canvasRef={canvasRef}
            items={items}
            todoMap={todoMap}
            attachmentMap={attachmentMap}
            imageUrls={imageUrls}
            onDrop={handleDrop}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onBeginDrag={beginDrag}
            onSelectTodo={setSelectedTodoId}
            onDeleteItem={deleteCanvasItem}
          />
        ) : (
          <ListView
            isTrashView={isTrashView}
            todos={todos}
            filteredTodos={filteredTodos}
            filteredDeletedTodos={filteredDeletedTodos}
            onUpdate={updateTodoField}
            onToggle={toggleTodo}
            onDelete={deleteTodo}
            onRestore={restoreTodo}
            onPurge={purgeTodo}
          />
        )}
      </section>

      <Inspector
        selectedTodo={selectedTodo}
        onUpdate={updateTodoField}
        onToggle={toggleTodo}
        onDelete={deleteTodo}
      />

      {toast && <Toast toast={toast} onDismiss={dismissToast} />}
      {confirmRequest && <ConfirmDialog request={confirmRequest} onResolve={handleConfirm} />}
    </main>
  );
}
