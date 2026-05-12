export type Priority = 'low' | 'medium' | 'high';
export type Mode = 'list' | 'canvas';
export type TaskFilter = 'all' | 'active' | 'due' | 'done' | 'trash';
export type SortMode = 'due' | 'updated';

export type Todo = {
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

export type BoardItem = {
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

export type Attachment = {
  id: string;
  board_id: string;
  todo_id: string | null;
  file_name: string;
  mime_type: string;
  local_path: string;
  size_bytes: number;
  sync_status: string;
};

export type PurgeResult = {
  todos: number;
  board_items: number;
  attachments: number;
  image_files: number;
};

export type DragState = {
  item: BoardItem;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  original: BoardItem;
};

export type WebDb = {
  todos: Todo[];
  boardItems: BoardItem[];
  attachments: Attachment[];
  imageUrls: Record<string, string>;
};

export const priorityLabel: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const UNDO_TIMEOUT_MS = 7000;
