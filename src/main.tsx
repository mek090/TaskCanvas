import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import './styles.css';

type Priority = 'low' | 'medium' | 'high';
type Mode = 'list' | 'canvas';

type Todo = {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  priority: Priority;
  due_date: string | null;
  tags: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_status: string;
  version: number;
};

type BoardItem = {
  id: string;
  board_id: string;
  item_type: 'todo' | 'image' | 'note';
  ref_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  sync_status: string;
};

type Attachment = {
  id: string;
  board_id: string;
  todo_id: string | null;
  file_name: string;
  mime_type: string;
  local_path: string;
  size_bytes: number;
  sync_status: string;
};

type DragState = {
  item: BoardItem;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: BoardItem;
};

type WebDb = {
  todos: Todo[];
  boardItems: BoardItem[];
  attachments: Attachment[];
  imageUrls: Record<string, string>;
};

const priorityLabel: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const UNDO_TIMEOUT_MS = 7000;

async function call<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) {
    return tauriInvoke<T>(command, args);
  }
  return webInvoke<T>(command, args);
}

function readWebDb(): WebDb {
  const raw = localStorage.getItem('taskcanvas.webdb.v1');
  if (raw) return JSON.parse(raw) as WebDb;
  return { todos: [], boardItems: [], attachments: [], imageUrls: {} };
}

function writeWebDb(db: WebDb) {
  localStorage.setItem('taskcanvas.webdb.v1', JSON.stringify(db));
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestamp() {
  return new Date().toISOString();
}

async function webInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const db = readWebDb();
  const now = timestamp();
  switch (command) {
    case 'init_db':
      return undefined as T;
    case 'list_todos':
      return db.todos.filter((todo) => !todo.deleted_at).sort((a, b) => Number(a.completed) - Number(b.completed)) as T;
    case 'list_board_items':
      return db.boardItems as T;
    case 'list_attachments':
      return db.attachments as T;
    case 'create_todo': {
      const input = args.input as Partial<Todo>;
      const todo: Todo = {
        id: uuid(), title: String(input.title ?? '').trim(), description: String(input.description ?? ''),
        completed: false, priority: (input.priority as Priority) ?? 'medium', due_date: null, tags: String(input.tags ?? ''),
        created_at: now, updated_at: now, deleted_at: null, sync_status: 'web_demo', version: 1,
      };
      db.todos.unshift(todo); writeWebDb(db); return todo as T;
    }
    case 'update_todo': {
      const input = (args.input as Todo);
      let updated: Todo | null = null;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== input.id || todo.deleted_at) return todo;
        const next = { ...todo, ...input, updated_at: now, version: todo.version + 1 };
        updated = next;
        return next;
      });
      if (!updated) throw new Error('Todo not found or already deleted');
      writeWebDb(db); return updated as T;
    }
    case 'toggle_todo': {
      let updated: Todo | null = null;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== args.id || todo.deleted_at) return todo;
        const next = { ...todo, completed: !todo.completed, updated_at: now, version: todo.version + 1 };
        updated = next;
        return next;
      });
      if (!updated) throw new Error('Todo not found or already deleted');
      writeWebDb(db); return updated as T;
    }
    case 'delete_todo': {
      let changed = false;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== args.id || todo.deleted_at) return todo;
        changed = true;
        return { ...todo, deleted_at: now, updated_at: now, version: todo.version + 1 };
      });
      if (!changed) throw new Error('Todo not found or already deleted');
      writeWebDb(db); return undefined as T;
    }
    case 'restore_todo': {
      let restored: Todo | null = null;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== args.id || !todo.deleted_at) return todo;
        const next = { ...todo, deleted_at: null, updated_at: now, version: todo.version + 1 };
        restored = next;
        return next;
      });
      if (!restored) throw new Error('Todo not found or not deleted');
      writeWebDb(db); return restored as T;
    }
    case 'upsert_board_item': {
      const input = args.input as Partial<BoardItem>;
      const item: BoardItem = {
        id: input.id ?? uuid(), board_id: input.board_id ?? 'main', item_type: input.item_type ?? 'todo', ref_id: input.ref_id ?? '',
        x: input.x ?? 80, y: input.y ?? 80, width: input.width ?? 260, height: input.height ?? 180, z_index: input.z_index ?? 1,
        sync_status: 'web_demo',
      };
      const index = db.boardItems.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) db.boardItems[index] = item; else db.boardItems.push(item);
      writeWebDb(db); return item as T;
    }
    case 'delete_board_item':
      db.boardItems = db.boardItems.filter((item) => item.id !== args.id);
      writeWebDb(db); return undefined as T;
    case 'save_image_data_url': {
      const id = uuid();
      const attachment: Attachment = {
        id, board_id: 'main', todo_id: (args.todoId as string | null) ?? null, file_name: String(args.fileName ?? `${id}.png`),
        mime_type: String(args.dataUrl).slice(5, String(args.dataUrl).indexOf(';')) || 'image/png', local_path: 'web-demo',
        size_bytes: String(args.dataUrl).length, sync_status: 'web_demo',
      };
      db.attachments.unshift(attachment);
      db.imageUrls[id] = String(args.dataUrl);
      db.boardItems.push({ id: uuid(), board_id: 'main', item_type: 'image', ref_id: id, x: Number(args.x ?? 80), y: Number(args.y ?? 80), width: 260, height: 180, z_index: 2, sync_status: 'web_demo' });
      writeWebDb(db); return attachment as T;
    }
    case 'get_attachment_data_url':
      return db.imageUrls[String(args.id)] as T;
    case 'export_snapshot':
      return JSON.stringify({ format: 'taskcanvas.web-demo.v1', exported_at: now, ...db }, null, 2) as T;
    default:
      throw new Error(`Unsupported web demo command: ${command}`);
  }
}

type EditableInputProps = {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
};

function EditableInput({ value, onCommit, placeholder }: EditableInputProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);
  return (
    <input
      ref={ref}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

function EditableTextarea({ value, onCommit, placeholder }: EditableInputProps) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur(); }
      }}
    />
  );
}

type ToastState = { message: string; undo?: () => void };

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  resolve: (ok: boolean) => void;
};

type ConfirmDialogProps = {
  request: ConfirmRequest;
  onResolve: (ok: boolean) => void;
};

function ConfirmDialog({ request, onResolve }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onResolve(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onResolve]);
  return (
    <div className="modal-backdrop" onClick={() => onResolve(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-title">{request.title}</h2>
        <p>{request.message}</p>
        <div className="modal-actions">
          <button onClick={() => onResolve(false)}>{request.cancelLabel ?? 'Cancel'}</button>
          <button ref={confirmRef} className="danger" onClick={() => onResolve(true)}>{request.confirmLabel ?? 'Confirm'}</button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [mode, setMode] = useState<Mode>('canvas');
  const [todos, setTodos] = useState<Todo[]>([]);
  const [items, setItems] = useState<BoardItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'done'>('all');
  const [draft, setDraft] = useState({ title: '', description: '', priority: 'medium' as Priority, tags: '' });
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [status, setStatus] = useState('Ready');
  const [drag, setDrag] = useState<DragState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const latestDraggedItem = useRef<BoardItem | null>(null);
  const todosRef = useRef<Todo[]>([]);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => { todosRef.current = todos; }, [todos]);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, undo?: () => void) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast({ message, undo });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, UNDO_TIMEOUT_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, []);

  const requestConfirm = useCallback((opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> => {
    return new Promise((resolve) => setConfirmRequest({ ...opts, resolve }));
  }, []);

  const handleConfirm = useCallback((ok: boolean) => {
    setConfirmRequest((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const refresh = useCallback(async () => {
    await call('init_db');
    const [todoData, boardData, attachmentData] = await Promise.all([
      call<Todo[]>('list_todos'),
      call<BoardItem[]>('list_board_items', { boardId: 'main' }),
      call<Attachment[]>('list_attachments', { boardId: 'main' }),
    ]);
    setTodos(todoData);
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
        missing.map(async (a) => [a.id, await call<string>('get_attachment_data_url', { id: a.id })] as const),
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

  const selectedTodo = useMemo(() => todos.find((todo) => todo.id === selectedTodoId) ?? null, [todos, selectedTodoId]);
  const todoMap = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const attachmentMap = useMemo(() => new Map(attachments.map((attachment) => [attachment.id, attachment])), [attachments]);

  const filteredTodos = useMemo(() => {
    const q = query.trim().toLowerCase();
    return todos.filter((todo) => {
      if (filter === 'active' && todo.completed) return false;
      if (filter === 'done' && !todo.completed) return false;
      if (!q) return true;
      return `${todo.title} ${todo.description} ${todo.tags}`.toLowerCase().includes(q);
    });
  }, [todos, query, filter]);

  async function createTodo(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) return;
    try {
      const todo = await call<Todo>('create_todo', { input: draft });
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
      setDraft({ title: '', description: '', priority: 'medium', tags: '' });
      setSelectedTodoId(todo.id);
      setStatus('Created task and placed it on canvas');
      await refresh();
    } catch (err) {
      setStatus(`Create failed: ${String(err)}`);
    }
  }

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

  const deleteTodo = useCallback(async (id: string) => {
    try {
      await call('delete_todo', { id });
      setTodos((prev) => prev.filter((todo) => todo.id !== id));
      if (selectedTodoId === id) setSelectedTodoId(null);
      setStatus('Task moved to trash');
      showToast('Task deleted', async () => {
        try {
          const restored = await call<Todo>('restore_todo', { id });
          setTodos((prev) => (prev.some((t) => t.id === restored.id) ? prev.map((t) => (t.id === restored.id ? restored : t)) : [restored, ...prev]));
          dismissToast();
          setStatus('Task restored');
        } catch (err) {
          setStatus(`Restore failed: ${String(err)}`);
        }
      });
    } catch (err) {
      setStatus(`Delete failed: ${String(err)}`);
    }
  }, [dismissToast, selectedTodoId, showToast]);

  async function placeExistingTodo(todo: Todo) {
    const already = items.some((item) => item.item_type === 'todo' && item.ref_id === todo.id);
    if (already) return setStatus('Task is already on canvas');
    try {
      await call('upsert_board_item', {
        input: { item_type: 'todo', ref_id: todo.id, x: 120, y: 120, width: 280, height: 170, z_index: 4 },
      });
      setStatus('Placed task on canvas');
      await refresh();
    } catch (err) {
      setStatus(`Place failed: ${String(err)}`);
    }
  }

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
      const imageItem = Array.from(event.clipboardData?.items ?? []).find((item) => item.type.startsWith('image/'));
      if (!imageItem) return;
      event.preventDefault();
      const file = imageItem.getAsFile();
      if (!file) return;
      try {
        const dataUrl = await fileToDataUrl(file);
        const canvas = canvasRef.current;
        const point = canvas
          ? { x: canvas.scrollLeft + canvas.clientWidth / 2 - 130, y: canvas.scrollTop + canvas.clientHeight / 2 - 90 }
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

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const point = rect && canvas
      ? { x: event.clientX - rect.left + canvas.scrollLeft, y: event.clientY - rect.top + canvas.scrollTop }
      : { x: 140, y: 140 };
    const imageFiles = Array.from(event.dataTransfer.files).filter((file) => file.type.startsWith('image/'));
    for (const [index, file] of imageFiles.entries()) {
      try {
        const dataUrl = await fileToDataUrl(file);
        await saveImage(dataUrl, file.name, { x: point.x + index * 28, y: point.y + index * 28 });
      } catch (err) {
        setStatus(`Image dropped failed: ${String(err)}`);
      }
    }
  }

  function beginDrag(event: React.PointerEvent, item: BoardItem, mode: 'move' | 'resize') {
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    const topZ = Math.max(1, ...items.map((candidate) => candidate.z_index));
    const lifted = { ...item, z_index: topZ + 1 };
    latestDraggedItem.current = lifted;
    setItems((prev) => prev.map((candidate) => (candidate.id === item.id ? lifted : candidate)));
    setDrag({ item: lifted, mode, startX: event.clientX, startY: event.clientY, original: { ...lifted } });
  }

  async function endDrag() {
    if (!drag) return;
    const latest = latestDraggedItem.current ?? items.find((item) => item.id === drag.item.id) ?? drag.item;
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
  }

  function moveDrag(event: React.PointerEvent) {
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const nextDraggedItem = drag.mode === 'move'
      ? { ...drag.original, x: Math.max(-40, drag.original.x + dx), y: Math.max(-40, drag.original.y + dy) }
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
  }

  const deleteCanvasItem = useCallback(async (id: string) => {
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
          setItems((prev) => (prev.some((item) => item.id === restored.id) ? prev.map((item) => (item.id === restored.id ? restored : item)) : [...prev, restored]));
          dismissToast();
          setStatus('Item restored to canvas');
        } catch (err) {
          setStatus(`Restore failed: ${String(err)}`);
        }
      });
    } catch (err) {
      setStatus(`Remove failed: ${String(err)}`);
    }
  }, [dismissToast, items, showToast]);

  async function exportBackup() {
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
  }

  async function importBackup() {
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
        message: 'Importing will REPLACE all current tasks, board items, and images. Your current database will be backed up automatically before import.',
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
      setStatus(`Imported ${result.todos} tasks, ${result.board_items} canvas items, ${result.images} images. Previous DB → ${result.backup_path}`);
    } catch (err) {
      setStatus(`Import failed: ${String(err)}`);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">TC</div>
          <div>
            <h1>TaskCanvas</h1>
            <p>Local-first visual todo</p>
          </div>
        </div>

        <form className="composer" onSubmit={createTodo}>
          <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="New task title" />
          <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Notes / checklist ideas" />
          <div className="row">
            <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value as Priority })}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <input value={draft.tags} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} placeholder="tags" />
          </div>
          <button type="submit">+ Add Task</button>
        </form>

        <div className="toolbar">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search tasks" />
          <div className="segmented">
            {(['all', 'active', 'done'] as const).map((name) => (
              <button className={filter === name ? 'active' : ''} onClick={() => setFilter(name)} key={name}>
                {name}
              </button>
            ))}
          </div>
        </div>

        <div className="task-list">
          {filteredTodos.map((todo) => (
            <article className={`task-row ${selectedTodoId === todo.id ? 'selected' : ''}`} key={todo.id} onClick={() => setSelectedTodoId(todo.id)}>
              <button className={`check ${todo.completed ? 'done' : ''}`} onClick={(e) => { e.stopPropagation(); void toggleTodo(todo); }}>
                {todo.completed ? '✓' : ''}
              </button>
              <div className="task-row-body">
                <strong>{todo.title}</strong>
                <span>{todo.description || 'No description'}</span>
                <small><b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b> {todo.tags}</small>
              </div>
              <button className="ghost" onClick={(e) => { e.stopPropagation(); void placeExistingTodo(todo); }}>Board</button>
            </article>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h2>{mode === 'canvas' ? 'Canvas Board' : 'List Mode'}</h2>
            <p>{status}</p>
          </div>
          <div className="actions">
            <button className={mode === 'canvas' ? 'active' : ''} onClick={() => setMode('canvas')}>Canvas</button>
            <button className={mode === 'list' ? 'active' : ''} onClick={() => setMode('list')}>List</button>
            <button onClick={exportBackup}>Export Backup</button>
            <button onClick={importBackup}>Import Backup</button>
          </div>
        </header>

        {mode === 'canvas' ? (
          <div
            ref={canvasRef}
            className="canvas"
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="drop-hint">Paste screenshot with Ctrl+V or drag image files here. Drag cards/images to arrange. Resize from bottom-right.</div>
            {items.map((item) => {
              const style = { left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.z_index };
              if (item.item_type === 'todo') {
                const todo = todoMap.get(item.ref_id);
                if (!todo) return null;
                return (
                  <div className={`canvas-card todo-card ${todo.completed ? 'completed' : ''}`} style={style} key={item.id} onPointerDown={(e) => { setSelectedTodoId(todo.id); beginDrag(e, item, 'move'); }}>
                    <div className="card-head">
                      <b className={`pill ${todo.priority}`}>{priorityLabel[todo.priority]}</b>
                      <button onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteCanvasItem(item.id)}>×</button>
                    </div>
                    <h3>{todo.title}</h3>
                    <p>{todo.description}</p>
                    <footer>{todo.tags || 'untagged'}</footer>
                    <span className="resize" onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, item, 'resize'); }} />
                  </div>
                );
              }
              const attachment = attachmentMap.get(item.ref_id);
              if (!attachment) return null;
              return (
                <div className="canvas-card image-card" style={style} key={item.id} onPointerDown={(e) => beginDrag(e, item, 'move')}>
                  {imageUrls[attachment.id] ? <img src={imageUrls[attachment.id]} alt={attachment.file_name} draggable={false} /> : <div className="image-loading">Loading image...</div>}
                  <div className="image-caption">
                    <span>{attachment.file_name}</span>
                    <button onPointerDown={(e) => e.stopPropagation()} onClick={() => deleteCanvasItem(item.id)}>×</button>
                  </div>
                  <span className="resize" onPointerDown={(e) => { e.stopPropagation(); beginDrag(e, item, 'resize'); }} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="list-mode">
            {filteredTodos.map((todo) => (
              <article className="detail-card" key={todo.id}>
                <EditableInput value={todo.title} onCommit={(v) => updateTodoField(todo.id, { title: v })} />
                <EditableTextarea value={todo.description} onCommit={(v) => updateTodoField(todo.id, { description: v })} />
                <div className="row">
                  <select value={todo.priority} onChange={(e) => updateTodoField(todo.id, { priority: e.target.value as Priority })}>
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                  </select>
                  <button onClick={() => toggleTodo(todo)}>{todo.completed ? 'Mark active' : 'Complete'}</button>
                  <button className="danger" onClick={() => deleteTodo(todo.id)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <aside className="inspector">
        <h2>Inspector</h2>
        {selectedTodo ? (
          <div className="inspector-form">
            <label>Title<EditableInput value={selectedTodo.title} onCommit={(v) => updateTodoField(selectedTodo.id, { title: v })} /></label>
            <label>Description<EditableTextarea value={selectedTodo.description} onCommit={(v) => updateTodoField(selectedTodo.id, { description: v })} /></label>
            <label>Priority<select value={selectedTodo.priority} onChange={(e) => updateTodoField(selectedTodo.id, { priority: e.target.value as Priority })}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label>Tags<EditableInput value={selectedTodo.tags} onCommit={(v) => updateTodoField(selectedTodo.id, { tags: v })} /></label>
            <button onClick={() => toggleTodo(selectedTodo)}>{selectedTodo.completed ? 'Reopen task' : 'Mark complete'}</button>
            <button className="danger" onClick={() => deleteTodo(selectedTodo.id)}>Delete task</button>
          </div>
        ) : (
          <p className="muted">Select a task to edit. Images pasted while a task is selected will be linked to that task.</p>
        )}
        <div className="sync-card">
          <h3>Cloud-ready metadata</h3>
          <p>Todos, board items, and attachments already include UUIDs, updated_at, sync_status, soft-delete/version fields for future Supabase/S3/R2 sync.</p>
        </div>
      </aside>
      {toast && (
        <div className="toast" role="status">
          <span>{toast.message}</span>
          {toast.undo && <button className="toast-undo" onClick={toast.undo}>Undo</button>}
          <button className="toast-close" onClick={dismissToast} aria-label="Dismiss">×</button>
        </div>
      )}
      {confirmRequest && (
        <ConfirmDialog request={confirmRequest} onResolve={handleConfirm} />
      )}
    </main>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error(`Image too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${(MAX_IMAGE_BYTES / 1024 / 1024).toFixed(0)} MB.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || target.isContentEditable;
}

createRoot(document.getElementById('root')!).render(<App />);
