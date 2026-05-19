import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import type { Attachment, BoardItem, Priority, PurgeResult, Todo, WebDb } from './types';
import { normalizeDueDate } from './dates';
import { timestamp, uuid } from './files';

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function call<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
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

async function webInvoke<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const db = readWebDb();
  const now = timestamp();
  switch (command) {
    case 'init_db':
      return undefined as T;
    case 'list_todos':
      return db.todos.filter((todo) => !todo.deleted_at).sort(compareTodosForWeb) as T;
    case 'list_deleted_todos':
      return db.todos
        .filter((todo) => todo.deleted_at)
        .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at))) as T;
    case 'list_board_items':
      return db.boardItems as T;
    case 'list_attachments':
      return db.attachments as T;
    case 'create_todo': {
      const input = args.input as Partial<Todo>;
      const todo: Todo = {
        id: uuid(),
        title: String(input.title ?? '').trim(),
        description: String(input.description ?? ''),
        completed: false,
        priority: (input.priority as Priority) ?? 'medium',
        due_date: normalizeDueDate(input.due_date),
        tags: String(input.tags ?? ''),
        created_at: now,
        updated_at: now,
        deleted_at: null,
        sync_status: 'web_demo',
        version: 1,
      };
      db.todos.unshift(todo);
      writeWebDb(db);
      return todo as T;
    }
    case 'update_todo': {
      const input = args.input as Todo;
      let updated: Todo | null = null;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== input.id || todo.deleted_at) return todo;
        const next = { ...todo, ...input, updated_at: now, version: todo.version + 1 };
        updated = next;
        return next;
      });
      if (!updated) throw new Error('Todo not found or already deleted');
      writeWebDb(db);
      return updated as T;
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
      writeWebDb(db);
      return updated as T;
    }
    case 'delete_todo': {
      let changed = false;
      db.todos = db.todos.map((todo) => {
        if (todo.id !== args.id || todo.deleted_at) return todo;
        changed = true;
        return { ...todo, deleted_at: now, updated_at: now, version: todo.version + 1 };
      });
      if (!changed) throw new Error('Todo not found or already deleted');
      writeWebDb(db);
      return undefined as T;
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
      writeWebDb(db);
      return restored as T;
    }
    case 'purge_todo': {
      const id = String(args.id);
      const existed = db.todos.some((todo) => todo.id === id && todo.deleted_at);
      if (!existed) throw new Error('Todo not found in trash');
      const attachmentIds = new Set(
        db.attachments.filter((attachment) => attachment.todo_id === id).map((attachment) => attachment.id),
      );
      const result: PurgeResult = {
        todos: 1,
        board_items: db.boardItems.filter((item) => item.item_type === 'todo' && item.ref_id === id).length,
        attachments: attachmentIds.size,
        image_files: attachmentIds.size,
      };
      db.todos = db.todos.filter((todo) => todo.id !== id);
      db.boardItems = db.boardItems.filter((item) => !(item.item_type === 'todo' && item.ref_id === id));
      db.attachments = db.attachments.filter((attachment) => !attachmentIds.has(attachment.id));
      for (const attachmentId of attachmentIds) delete db.imageUrls[attachmentId];
      writeWebDb(db);
      return result as T;
    }
    case 'purge_deleted_todos': {
      const deletedIds = new Set(db.todos.filter((todo) => todo.deleted_at).map((todo) => todo.id));
      const orphanAttachmentIds = new Set(
        db.attachments
          .filter((attachment) => attachment.todo_id && !db.todos.some((todo) => todo.id === attachment.todo_id))
          .map((attachment) => attachment.id),
      );
      const linkedAttachmentIds = new Set(
        db.attachments
          .filter((attachment) => attachment.todo_id && deletedIds.has(attachment.todo_id))
          .map((attachment) => attachment.id),
      );
      const allAttachmentIds = new Set([...linkedAttachmentIds, ...orphanAttachmentIds]);
      const result: PurgeResult = {
        todos: deletedIds.size,
        board_items: db.boardItems.filter((item) => item.item_type === 'todo' && deletedIds.has(item.ref_id)).length,
        attachments: allAttachmentIds.size,
        image_files: allAttachmentIds.size,
      };
      db.todos = db.todos.filter((todo) => !deletedIds.has(todo.id));
      db.boardItems = db.boardItems.filter((item) => !(item.item_type === 'todo' && deletedIds.has(item.ref_id)));
      db.attachments = db.attachments.filter((attachment) => !allAttachmentIds.has(attachment.id));
      for (const attachmentId of allAttachmentIds) delete db.imageUrls[attachmentId];
      writeWebDb(db);
      return result as T;
    }
    case 'upsert_board_item': {
      const input = args.input as Partial<BoardItem>;
      const item: BoardItem = {
        id: input.id ?? uuid(),
        board_id: input.board_id ?? 'main',
        item_type: input.item_type ?? 'todo',
        ref_id: input.ref_id ?? '',
        x: input.x ?? 80,
        y: input.y ?? 80,
        width: input.width ?? 260,
        height: input.height ?? 180,
        z_index: input.z_index ?? 1,
        sync_status: 'web_demo',
      };
      const index = db.boardItems.findIndex((candidate) => candidate.id === item.id);
      if (index >= 0) db.boardItems[index] = item;
      else db.boardItems.push(item);
      writeWebDb(db);
      return item as T;
    }
    case 'delete_board_item':
      db.boardItems = db.boardItems.filter((item) => item.id !== args.id);
      writeWebDb(db);
      return undefined as T;
    case 'save_image_data_url': {
      const id = uuid();
      const attachment: Attachment = {
        id,
        board_id: 'main',
        todo_id: (args.todoId as string | null) ?? null,
        file_name: String(args.fileName ?? `${id}.png`),
        mime_type: String(args.dataUrl).slice(5, String(args.dataUrl).indexOf(';')) || 'image/png',
        local_path: 'web-demo',
        size_bytes: String(args.dataUrl).length,
        sync_status: 'web_demo',
      };
      db.attachments.unshift(attachment);
      db.imageUrls[id] = String(args.dataUrl);
      db.boardItems.push({
        id: uuid(),
        board_id: 'main',
        item_type: 'image',
        ref_id: id,
        x: Number(args.x ?? 80),
        y: Number(args.y ?? 80),
        width: Number(args.width ?? 260),
        height: Number(args.height ?? 180),
        z_index: 2,
        sync_status: 'web_demo',
      });
      writeWebDb(db);
      return attachment as T;
    }
    case 'get_attachment_data_url':
      return db.imageUrls[String(args.id)] as T;
    case 'export_snapshot':
      return JSON.stringify({ format: 'taskcanvas.web-demo.v1', exported_at: now, ...db }, null, 2) as T;
    default:
      throw new Error(`Unsupported web demo command: ${command}`);
  }
}

// Mirror backend ordering for the localStorage adapter: active first, dated before undated,
// soonest first, then most-recently updated.
function compareTodosForWeb(a: Todo, b: Todo) {
  const completedDelta = Number(a.completed) - Number(b.completed);
  if (completedDelta !== 0) return completedDelta;
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return b.updated_at.localeCompare(a.updated_at);
}
