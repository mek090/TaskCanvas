import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './main';

function sidebar() {
  return screen.getAllByRole('complementary')[0];
}

async function addTask(user: ReturnType<typeof userEvent.setup>, title: string, opts: { description?: string; dueDate?: string } = {}) {
  const form = document.querySelector('form.composer') as HTMLFormElement;
  const scope = within(form);
  await user.type(scope.getByPlaceholderText('New task title'), title);
  if (opts.description) await user.type(scope.getByPlaceholderText('Notes / checklist ideas'), opts.description);
  if (opts.dueDate) fireEvent.change(scope.getByLabelText('Due date'), { target: { value: opts.dueDate } });
  await user.click(scope.getByRole('button', { name: /add task/i }));
  await waitFor(() => expect(within(sidebar()).getByText(title)).toBeInTheDocument());
}

describe('TaskCanvas frontend flows', () => {
  it('creates a task through the composer and persists it in the active list', async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTask(user, 'Write frontend tests', { description: 'Safety net before refactor' });

    expect(within(sidebar()).getByText('Write frontend tests')).toBeInTheDocument();
    expect(within(sidebar()).getByText('Safety net before refactor')).toBeInTheDocument();
    expect(screen.getByText('Created task and placed it on canvas')).toBeInTheDocument();
  });

  it('moves deleted tasks to Trash and restores them', async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTask(user, 'Restore me');
    await user.click(screen.getByRole('button', { name: /delete task/i }));
    await user.click(screen.getByRole('button', { name: /^trash$/i }));

    expect(await within(sidebar()).findByText('Restore me')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => expect(screen.getByRole('button', { name: /^all$/i })).toHaveClass('active'));
    expect(within(sidebar()).getByText('Restore me')).toBeInTheDocument();
  });

  it('shows overdue due-date badges and filters due tasks', async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTask(user, 'Past due task', { dueDate: '2026-05-12' });
    await addTask(user, 'No due task');

    expect(within(sidebar()).getByText(/Overdue · 2026-05-12/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^due$/i }));

    expect(within(sidebar()).getByText('Past due task')).toBeInTheDocument();
    expect(within(sidebar()).queryByText('No due task')).not.toBeInTheDocument();
  });

  it('sorts active due tasks by due date before undated tasks', async () => {
    const user = userEvent.setup();
    render(<App />);

    await addTask(user, 'Later task', { dueDate: '2026-05-20' });
    await addTask(user, 'No date task');
    await addTask(user, 'Soon task', { dueDate: '2026-05-10' });

    const rows = within(sidebar()).getAllByRole('article').map((row) => row.textContent ?? '');
    expect(rows[0]).toContain('Soon task');
    expect(rows[1]).toContain('Later task');
    expect(rows[2]).toContain('No date task');
  });
});
