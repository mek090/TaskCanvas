import type { Todo } from './types';

export function todayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeDueDate(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isOverdue(todo: Todo) {
  return Boolean(todo.due_date && !todo.completed && todo.due_date < todayKey());
}

export function dueLabel(todo: Todo) {
  if (!todo.due_date) return 'No due date';
  if (todo.due_date === todayKey()) return 'Due today';
  if (isOverdue(todo)) return `Overdue · ${todo.due_date}`;
  return `Due ${todo.due_date}`;
}

export function compareTodosByDue(a: Todo, b: Todo) {
  const completedDelta = Number(a.completed) - Number(b.completed);
  if (completedDelta !== 0) return completedDelta;
  if (a.due_date && b.due_date && a.due_date !== b.due_date) return a.due_date.localeCompare(b.due_date);
  if (a.due_date && !b.due_date) return -1;
  if (!a.due_date && b.due_date) return 1;
  return b.updated_at.localeCompare(a.updated_at);
}

export function compareTodosByUpdated(a: Todo, b: Todo) {
  const completedDelta = Number(a.completed) - Number(b.completed);
  if (completedDelta !== 0) return completedDelta;
  return b.updated_at.localeCompare(a.updated_at);
}
