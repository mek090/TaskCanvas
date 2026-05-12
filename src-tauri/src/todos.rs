use crate::db::{app_dir, conn, init_db_inner, now};
use crate::models::{CreateTodoInput, PurgeResult, Todo, UpdateTodoInput};
use rusqlite::{params, Connection};
use std::fs;
use std::path::Path;
use tauri::AppHandle;
use uuid::Uuid;

fn read_todo(c: &Connection, id: &str) -> Result<Todo, String> {
    c.query_row(
        "SELECT id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version
         FROM todos WHERE id=?1",
        params![id],
        |row| {
            Ok(Todo {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                completed: row.get::<_, i64>(3)? == 1,
                priority: row.get(4)?,
                due_date: row.get(5)?,
                tags: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                deleted_at: row.get(9)?,
                sync_status: row.get(10)?,
                version: row.get(11)?,
            })
        },
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn list_todos_from_conn(c: &Connection) -> Result<Vec<Todo>, String> {
    let mut stmt = c
        .prepare(
            "SELECT id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version
             FROM todos
             WHERE deleted_at IS NULL
             ORDER BY completed ASC, due_date IS NULL ASC, due_date ASC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Todo {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                completed: row.get::<_, i64>(3)? == 1,
                priority: row.get(4)?,
                due_date: row.get(5)?,
                tags: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                deleted_at: row.get(9)?,
                sync_status: row.get(10)?,
                version: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn list_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    list_todos_from_conn(&c)
}

#[tauri::command]
pub(crate) fn list_deleted_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    let mut stmt = c
        .prepare(
            "SELECT id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version
             FROM todos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, updated_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Todo {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                completed: row.get::<_, i64>(3)? == 1,
                priority: row.get(4)?,
                due_date: row.get(5)?,
                tags: row.get(6)?,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
                deleted_at: row.get(9)?,
                sync_status: row.get(10)?,
                version: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub(crate) fn create_todo(app: AppHandle, input: CreateTodoInput) -> Result<Todo, String> {
    init_db_inner(&app)?;
    let title = input.title.trim();
    if title.is_empty() {
        return Err("Title is required".into());
    }
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let todo = Todo {
        id: id.clone(),
        title: title.to_string(),
        description: input.description.unwrap_or_default(),
        completed: false,
        priority: input.priority.unwrap_or_else(|| "medium".into()),
        due_date: input.due_date,
        tags: input.tags.unwrap_or_default(),
        created_at: ts.clone(),
        updated_at: ts.clone(),
        deleted_at: None,
        sync_status: "pending_create".into(),
        version: 1,
    };
    let c = conn(&app)?;
    c.execute(
        "INSERT INTO todos (id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version)
         VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,NULL,?9,?10)",
        params![todo.id, todo.title, todo.description, todo.priority, todo.due_date, todo.tags, todo.created_at, todo.updated_at, todo.sync_status, todo.version],
    )
    .map_err(|e| e.to_string())?;
    Ok(todo)
}

#[tauri::command]
pub(crate) fn update_todo(app: AppHandle, input: UpdateTodoInput) -> Result<Todo, String> {
    init_db_inner(&app)?;
    if input.title.trim().is_empty() {
        return Err("Title is required".into());
    }
    let c = conn(&app)?;
    let affected = c.execute(
        "UPDATE todos SET title=?2, description=?3, completed=?4, priority=?5, due_date=?6, tags=?7,
         updated_at=?8, sync_status='pending_update', version=version+1 WHERE id=?1 AND deleted_at IS NULL",
        params![input.id, input.title.trim(), input.description, if input.completed {1} else {0}, input.priority, input.due_date, input.tags, now()],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Todo not found or already deleted".into());
    }
    read_todo(&c, &input.id)
}

#[tauri::command]
pub(crate) fn toggle_todo(app: AppHandle, id: String) -> Result<Todo, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    let affected = c.execute(
        "UPDATE todos SET completed=CASE completed WHEN 1 THEN 0 ELSE 1 END,
         updated_at=?2, sync_status='pending_update', version=version+1 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now()],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Todo not found or already deleted".into());
    }
    read_todo(&c, &id)
}

#[tauri::command]
pub(crate) fn delete_todo(app: AppHandle, id: String) -> Result<(), String> {
    init_db_inner(&app)?;
    let mut c = conn(&app)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let affected = tx.execute(
        "UPDATE todos SET deleted_at=?2, updated_at=?2, sync_status='pending_delete', version=version+1 WHERE id=?1 AND deleted_at IS NULL",
        params![id, now()],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Todo not found or already deleted".into());
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn restore_todo(app: AppHandle, id: String) -> Result<Todo, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    let affected = c.execute(
        "UPDATE todos SET deleted_at=NULL, updated_at=?2, sync_status='pending_update', version=version+1 WHERE id=?1 AND deleted_at IS NOT NULL",
        params![id, now()],
    )
    .map_err(|e| e.to_string())?;
    if affected == 0 {
        return Err("Todo not found or not deleted".into());
    }
    read_todo(&c, &id)
}

fn remove_local_attachment_files(paths: &[String], images_dir: &Path) -> usize {
    paths
        .iter()
        .filter(|path| {
            let candidate = Path::new(path);
            if !candidate.starts_with(images_dir) || !candidate.exists() {
                return false;
            }
            fs::remove_file(candidate).is_ok()
        })
        .count()
}

pub(crate) fn purge_todo_inner(
    c: &mut Connection,
    images_dir: &Path,
    id: &str,
) -> Result<PurgeResult, String> {
    let exists: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM todos WHERE id=?1 AND deleted_at IS NOT NULL",
            params![id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists == 0 {
        return Err("Todo not found in trash".into());
    }

    let attachment_paths = {
        let mut stmt = c
            .prepare("SELECT local_path FROM attachments WHERE todo_id=?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let tx = c.transaction().map_err(|e| e.to_string())?;
    let board_items = tx
        .execute(
            "DELETE FROM board_items WHERE item_type='todo' AND ref_id=?1",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    let attachments = tx
        .execute("DELETE FROM attachments WHERE todo_id=?1", params![id])
        .map_err(|e| e.to_string())?;
    let todos = tx
        .execute(
            "DELETE FROM todos WHERE id=?1 AND deleted_at IS NOT NULL",
            params![id],
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(PurgeResult {
        todos,
        board_items,
        attachments,
        image_files: remove_local_attachment_files(&attachment_paths, images_dir),
    })
}

pub(crate) fn purge_orphan_attachments_inner(
    c: &mut Connection,
    images_dir: &Path,
) -> Result<PurgeResult, String> {
    let attachment_paths = {
        let mut stmt = c
            .prepare(
                "SELECT local_path FROM attachments
                 WHERE todo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM todos WHERE todos.id = attachments.todo_id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    let tx = c.transaction().map_err(|e| e.to_string())?;
    let attachments = tx
        .execute(
            "DELETE FROM attachments
             WHERE todo_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM todos WHERE todos.id = attachments.todo_id)",
            [],
        )
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    Ok(PurgeResult {
        attachments,
        image_files: remove_local_attachment_files(&attachment_paths, images_dir),
        ..Default::default()
    })
}

pub(crate) fn purge_deleted_todos_inner(
    c: &mut Connection,
    images_dir: &Path,
) -> Result<PurgeResult, String> {
    let ids = {
        let mut stmt = c
            .prepare("SELECT id FROM todos WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };

    let mut total = PurgeResult::default();
    for id in ids {
        total.add(purge_todo_inner(c, images_dir, &id)?);
    }
    total.add(purge_orphan_attachments_inner(c, images_dir)?);
    Ok(total)
}

#[tauri::command]
pub(crate) fn purge_todo(app: AppHandle, id: String) -> Result<PurgeResult, String> {
    init_db_inner(&app)?;
    let images_dir = app_dir(&app)?.join("images");
    let mut c = conn(&app)?;
    purge_todo_inner(&mut c, &images_dir, &id)
}

#[tauri::command]
pub(crate) fn purge_deleted_todos(app: AppHandle) -> Result<PurgeResult, String> {
    init_db_inner(&app)?;
    let images_dir = app_dir(&app)?.join("images");
    let mut c = conn(&app)?;
    purge_deleted_todos_inner(&mut c, &images_dir)
}
