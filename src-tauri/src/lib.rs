use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Todo {
    id: String,
    title: String,
    description: String,
    completed: bool,
    priority: String,
    due_date: Option<String>,
    tags: String,
    created_at: String,
    updated_at: String,
    deleted_at: Option<String>,
    sync_status: String,
    version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct BoardItem {
    id: String,
    board_id: String,
    item_type: String,
    ref_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: i64,
    created_at: String,
    updated_at: String,
    sync_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Attachment {
    id: String,
    todo_id: Option<String>,
    board_id: String,
    file_name: String,
    mime_type: String,
    local_path: String,
    width: Option<i64>,
    height: Option<i64>,
    size_bytes: i64,
    created_at: String,
    updated_at: String,
    sync_status: String,
}

#[derive(Debug, Deserialize)]
struct CreateTodoInput {
    title: String,
    description: Option<String>,
    priority: Option<String>,
    due_date: Option<String>,
    tags: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UpdateTodoInput {
    id: String,
    title: String,
    description: String,
    completed: bool,
    priority: String,
    due_date: Option<String>,
    tags: String,
}

#[derive(Debug, Deserialize)]
struct BoardItemInput {
    id: Option<String>,
    board_id: Option<String>,
    item_type: String,
    ref_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    z_index: Option<i64>,
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

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

fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("taskcanvas.sqlite3"))
}

fn conn(app: &AppHandle) -> Result<Connection, String> {
    let c = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    c.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}

struct Migration {
    version: u32,
    name: &'static str,
    sql: &'static str,
}

const MIGRATIONS: &[Migration] = &[Migration {
    version: 1,
    name: "initial_schema",
    sql: r#"
            CREATE TABLE IF NOT EXISTS todos (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                completed INTEGER NOT NULL DEFAULT 0,
                priority TEXT NOT NULL DEFAULT 'medium',
                due_date TEXT,
                tags TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                deleted_at TEXT,
                sync_status TEXT NOT NULL DEFAULT 'pending_create',
                version INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                todo_id TEXT,
                board_id TEXT NOT NULL DEFAULT 'main',
                file_name TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                local_path TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sync_status TEXT NOT NULL DEFAULT 'pending_create',
                FOREIGN KEY(todo_id) REFERENCES todos(id)
            );

            CREATE TABLE IF NOT EXISTS board_items (
                id TEXT PRIMARY KEY,
                board_id TEXT NOT NULL DEFAULT 'main',
                item_type TEXT NOT NULL CHECK(item_type IN ('todo','image','note')),
                ref_id TEXT NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                z_index INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                sync_status TEXT NOT NULL DEFAULT 'pending_create'
            );

            CREATE INDEX IF NOT EXISTS idx_todos_deleted ON todos(deleted_at);
            CREATE INDEX IF NOT EXISTS idx_board_items_board ON board_items(board_id);
            CREATE INDEX IF NOT EXISTS idx_attachments_board ON attachments(board_id);
        "#,
}];

fn ensure_migrations_table(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())
}

fn current_schema_version(c: &Connection) -> Result<u32, String> {
    ensure_migrations_table(c)?;
    c.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, u32>(0),
    )
    .map_err(|e| e.to_string())
}

fn run_migrations(c: &mut Connection) -> Result<u32, String> {
    let mut current = current_schema_version(c)?;
    for migration in MIGRATIONS {
        if migration.version <= current {
            continue;
        }
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(migration.sql).map_err(|e| {
            format!(
                "Migration {} ({}) failed: {}",
                migration.version, migration.name, e
            )
        })?;
        tx.execute(
            "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
            params![migration.version, migration.name, now()],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        current = migration.version;
    }
    Ok(current)
}

fn backup_db_for_migration(app: &AppHandle) -> Result<Option<PathBuf>, String> {
    let db = db_path(app)?;
    if !db.exists() {
        return Ok(None);
    }
    let needs_backup = {
        let c = conn(app)?;
        let current = current_schema_version(&c)?;
        current > 0 && MIGRATIONS.iter().any(|m| m.version > current)
    };
    if !needs_backup {
        return Ok(None);
    }
    let backup_name = format!(
        "taskcanvas.sqlite3.premigration-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S")
    );
    let backup = app_dir(app)?.join(backup_name);
    fs::copy(&db, &backup).map_err(|e| e.to_string())?;
    Ok(Some(backup))
}

fn init_db_inner(app: &AppHandle) -> Result<(), String> {
    let _ = backup_db_for_migration(app)?;
    let mut c = conn(app)?;
    run_migrations(&mut c)?;
    Ok(())
}

#[tauri::command]
fn init_db(app: AppHandle) -> Result<(), String> {
    init_db_inner(&app)
}

#[tauri::command]
fn list_todos(app: AppHandle) -> Result<Vec<Todo>, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    let mut stmt = c
        .prepare(
            "SELECT id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version
             FROM todos WHERE deleted_at IS NULL ORDER BY completed ASC, updated_at DESC",
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
fn create_todo(app: AppHandle, input: CreateTodoInput) -> Result<Todo, String> {
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
fn update_todo(app: AppHandle, input: UpdateTodoInput) -> Result<Todo, String> {
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
fn toggle_todo(app: AppHandle, id: String) -> Result<Todo, String> {
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
fn delete_todo(app: AppHandle, id: String) -> Result<(), String> {
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
fn restore_todo(app: AppHandle, id: String) -> Result<Todo, String> {
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

#[tauri::command]
fn list_board_items(app: AppHandle, board_id: Option<String>) -> Result<Vec<BoardItem>, String> {
    init_db_inner(&app)?;
    let board = board_id.unwrap_or_else(|| "main".into());
    let c = conn(&app)?;
    let mut stmt = c.prepare(
        "SELECT id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status
         FROM board_items WHERE board_id=?1 ORDER BY z_index ASC, updated_at ASC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![board], |row| {
            Ok(BoardItem {
                id: row.get(0)?,
                board_id: row.get(1)?,
                item_type: row.get(2)?,
                ref_id: row.get(3)?,
                x: row.get(4)?,
                y: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                z_index: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                sync_status: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn upsert_board_item(app: AppHandle, input: BoardItemInput) -> Result<BoardItem, String> {
    init_db_inner(&app)?;
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let board_id = input.board_id.unwrap_or_else(|| "main".into());
    let ts = now();
    let item = BoardItem {
        id: id.clone(),
        board_id: board_id.clone(),
        item_type: input.item_type,
        ref_id: input.ref_id,
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        z_index: input.z_index.unwrap_or(1),
        created_at: ts.clone(),
        updated_at: ts.clone(),
        sync_status: "pending_update".into(),
    };
    let c = conn(&app)?;
    c.execute(
        "INSERT INTO board_items (id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'pending_create')
         ON CONFLICT(id) DO UPDATE SET x=excluded.x,y=excluded.y,width=excluded.width,height=excluded.height,z_index=excluded.z_index,
         updated_at=excluded.updated_at,sync_status='pending_update'",
        params![item.id, item.board_id, item.item_type, item.ref_id, item.x, item.y, item.width, item.height, item.z_index, item.created_at, item.updated_at],
    ).map_err(|e| e.to_string())?;
    Ok(item)
}

#[tauri::command]
fn delete_board_item(app: AppHandle, id: String) -> Result<(), String> {
    init_db_inner(&app)?;
    conn(&app)?
        .execute("DELETE FROM board_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
const MAX_BASE64_BODY_BYTES: usize = MAX_IMAGE_BYTES / 3 * 4 + 4;

fn parse_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
    let (header, body) = data_url.split_once(',').ok_or("Invalid data URL")?;
    if !header.contains(";base64") {
        return Err("Image data URL must be base64 encoded".into());
    }
    if body.len() > MAX_BASE64_BODY_BYTES {
        return Err("Image is too large; max size is 15 MB".into());
    }
    let mime = header
        .strip_prefix("data:")
        .and_then(|s| s.split(';').next())
        .ok_or("Missing mime type")?
        .to_string();
    let allowed = matches!(
        mime.as_str(),
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    );
    if !allowed {
        return Err("Only PNG, JPEG, WebP, and GIF images are supported".into());
    }
    let bytes = general_purpose::STANDARD
        .decode(body)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("Image is too large; max size is 15 MB".into());
    }
    Ok((mime, bytes))
}

fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' '))
        .take(96)
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
fn save_image_data_url(
    app: AppHandle,
    data_url: String,
    file_name: Option<String>,
    todo_id: Option<String>,
    board_id: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<Attachment, String> {
    init_db_inner(&app)?;
    let (mime, bytes) = parse_data_url(&data_url)?;
    let id = Uuid::new_v4().to_string();
    let ext = match mime.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "img",
    };
    let safe_name = file_name
        .map(|name| sanitize_file_name(&name))
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| format!("{}.{}", id, ext));
    let local_path = app_dir(&app)?
        .join("images")
        .join(format!("{}.{}", id, ext));
    fs::write(&local_path, &bytes).map_err(|e| e.to_string())?;

    let ts = now();
    let board = board_id.unwrap_or_else(|| "main".into());
    let attachment = Attachment {
        id: id.clone(),
        todo_id,
        board_id: board.clone(),
        file_name: safe_name,
        mime_type: mime,
        local_path: local_path.to_string_lossy().to_string(),
        width: None,
        height: None,
        size_bytes: bytes.len() as i64,
        created_at: ts.clone(),
        updated_at: ts.clone(),
        sync_status: "pending_create".into(),
    };
    let board_item_id = Uuid::new_v4().to_string();

    let mut c = conn(&app).inspect_err(|_| {
        let _ = fs::remove_file(&local_path);
    })?;
    let result: Result<(), String> = (|| {
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO attachments (id,todo_id,board_id,file_name,mime_type,local_path,width,height,size_bytes,created_at,updated_at,sync_status)
             VALUES (?1,?2,?3,?4,?5,?6,NULL,NULL,?7,?8,?9,?10)",
            params![attachment.id, attachment.todo_id, attachment.board_id, attachment.file_name, attachment.mime_type, attachment.local_path, attachment.size_bytes, attachment.created_at, attachment.updated_at, attachment.sync_status],
        ).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO board_items (id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status)
             VALUES (?1,?2,'image',?3,?4,?5,260.0,180.0,2,?6,?6,'pending_create')",
            params![board_item_id, board, id, x.unwrap_or(80.0), y.unwrap_or(80.0), ts],
        ).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    })();

    if let Err(err) = result {
        let _ = fs::remove_file(&local_path);
        return Err(err);
    }
    Ok(attachment)
}

#[tauri::command]
fn list_attachments(app: AppHandle, board_id: Option<String>) -> Result<Vec<Attachment>, String> {
    init_db_inner(&app)?;
    let board = board_id.unwrap_or_else(|| "main".into());
    let c = conn(&app)?;
    let mut stmt = c.prepare(
        "SELECT id,todo_id,board_id,file_name,mime_type,local_path,width,height,size_bytes,created_at,updated_at,sync_status
         FROM attachments WHERE board_id=?1 ORDER BY created_at DESC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![board], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                todo_id: row.get(1)?,
                board_id: row.get(2)?,
                file_name: row.get(3)?,
                mime_type: row.get(4)?,
                local_path: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                size_bytes: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                sync_status: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_attachment_data_url(app: AppHandle, id: String) -> Result<String, String> {
    init_db_inner(&app)?;
    let c = conn(&app)?;
    let (mime, path): (String, String) = c
        .query_row(
            "SELECT mime_type, local_path FROM attachments WHERE id=?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;

    let images_dir = app_dir(&app)?.join("images");
    let canonical_root = fs::canonicalize(&images_dir).map_err(|e| e.to_string())?;
    let canonical_path = fs::canonicalize(&path).map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err("Attachment path is outside the images directory".into());
    }

    let bytes = fs::read(&canonical_path).map_err(|e| e.to_string())?;
    Ok(format!(
        "data:{};base64,{}",
        mime,
        general_purpose::STANDARD.encode(bytes)
    ))
}

#[tauri::command]
fn export_snapshot(app: AppHandle) -> Result<String, String> {
    let todos = list_todos(app.clone())?;
    let board_items = list_board_items(app.clone(), Some("main".into()))?;
    let attachments = list_attachments(app, Some("main".into()))?;
    serde_json::to_string_pretty(&serde_json::json!({
        "format": "taskcanvas.snapshot.v1",
        "exported_at": now(),
        "todos": todos,
        "board_items": board_items,
        "attachments": attachments
    }))
    .map_err(|e| e.to_string())
}

const BACKUP_FORMAT: &str = "taskcanvas.backup";
const BACKUP_FORMAT_VERSION: u32 = 1;
const BACKUP_SCHEMA_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct BackupCounts {
    todos: usize,
    board_items: usize,
    attachments: usize,
    images: usize,
}

#[derive(Serialize, Deserialize)]
struct BackupManifest {
    format: String,
    format_version: u32,
    schema_version: u32,
    app_version: String,
    exported_at: String,
    counts: BackupCounts,
}

#[derive(Debug, Serialize)]
struct ImportResult {
    todos: usize,
    board_items: usize,
    attachments: usize,
    images: usize,
    backup_path: String,
}

fn sha256_hex(data: &[u8]) -> String {
    let hash = Sha256::digest(data);
    hash.iter().map(|b| format!("{:02x}", b)).collect()
}

fn list_all_todos(c: &Connection) -> Result<Vec<Todo>, String> {
    let mut stmt = c.prepare(
        "SELECT id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version
         FROM todos ORDER BY created_at ASC",
    ).map_err(|e| e.to_string())?;
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

fn list_all_board_items(c: &Connection) -> Result<Vec<BoardItem>, String> {
    let mut stmt = c.prepare(
        "SELECT id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status
         FROM board_items ORDER BY created_at ASC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(BoardItem {
                id: row.get(0)?,
                board_id: row.get(1)?,
                item_type: row.get(2)?,
                ref_id: row.get(3)?,
                x: row.get(4)?,
                y: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                z_index: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                sync_status: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn list_all_attachments(c: &Connection) -> Result<Vec<Attachment>, String> {
    let mut stmt = c.prepare(
        "SELECT id,todo_id,board_id,file_name,mime_type,local_path,width,height,size_bytes,created_at,updated_at,sync_status
         FROM attachments ORDER BY created_at ASC",
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Attachment {
                id: row.get(0)?,
                todo_id: row.get(1)?,
                board_id: row.get(2)?,
                file_name: row.get(3)?,
                mime_type: row.get(4)?,
                local_path: row.get(5)?,
                width: row.get(6)?,
                height: row.get(7)?,
                size_bytes: row.get(8)?,
                created_at: row.get(9)?,
                updated_at: row.get(10)?,
                sync_status: row.get(11)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn export_backup_inner(db_file: &Path, images_dir: &Path, target: &Path) -> Result<(), String> {
    let images_root = fs::canonicalize(images_dir).map_err(|e| e.to_string())?;

    let (todos, board_items, attachments_raw) = {
        let c = Connection::open(db_file).map_err(|e| e.to_string())?;
        (
            list_all_todos(&c)?,
            list_all_board_items(&c)?,
            list_all_attachments(&c)?,
        )
    };

    let mut image_entries: Vec<(String, Vec<u8>)> = Vec::with_capacity(attachments_raw.len());
    let mut attachments_export: Vec<Attachment> = Vec::with_capacity(attachments_raw.len());
    for a in &attachments_raw {
        let canon = fs::canonicalize(&a.local_path)
            .map_err(|e| format!("Cannot read attachment file {}: {}", a.local_path, e))?;
        if !canon.starts_with(&images_root) {
            return Err(format!("Attachment {} is outside images directory", a.id));
        }
        let basename = canon
            .file_name()
            .ok_or_else(|| format!("Invalid attachment path: {}", a.local_path))?
            .to_string_lossy()
            .to_string();
        let bytes = fs::read(&canon).map_err(|e| e.to_string())?;
        let mut a2 = a.clone();
        a2.local_path = format!("images/{}", basename);
        attachments_export.push(a2);
        image_entries.push((basename, bytes));
    }

    let manifest = BackupManifest {
        format: BACKUP_FORMAT.to_string(),
        format_version: BACKUP_FORMAT_VERSION,
        schema_version: BACKUP_SCHEMA_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: now(),
        counts: BackupCounts {
            todos: todos.len(),
            board_items: board_items.len(),
            attachments: attachments_export.len(),
            images: image_entries.len(),
        },
    };

    let manifest_json = serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?;
    let todos_json = serde_json::to_vec_pretty(&todos).map_err(|e| e.to_string())?;
    let board_items_json = serde_json::to_vec_pretty(&board_items).map_err(|e| e.to_string())?;
    let attachments_json =
        serde_json::to_vec_pretty(&attachments_export).map_err(|e| e.to_string())?;

    let file = fs::File::create(target).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let mut checksums: HashMap<String, String> = HashMap::new();

    let mut add_entry =
        |zip: &mut zip::ZipWriter<fs::File>, name: &str, data: &[u8]| -> Result<(), String> {
            zip.start_file(name, opts).map_err(|e| e.to_string())?;
            zip.write_all(data).map_err(|e| e.to_string())?;
            checksums.insert(name.to_string(), sha256_hex(data));
            Ok(())
        };

    add_entry(&mut zip, "data/todos.json", &todos_json)?;
    add_entry(&mut zip, "data/board_items.json", &board_items_json)?;
    add_entry(&mut zip, "data/attachments.json", &attachments_json)?;
    for (basename, bytes) in &image_entries {
        let name = format!("images/{}", basename);
        add_entry(&mut zip, &name, bytes)?;
    }

    let checksums_json = serde_json::to_vec_pretty(&checksums).map_err(|e| e.to_string())?;
    zip.start_file("checksums.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&checksums_json).map_err(|e| e.to_string())?;

    zip.start_file("manifest.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&manifest_json).map_err(|e| e.to_string())?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn export_backup(app: AppHandle, target_path: String) -> Result<(), String> {
    init_db_inner(&app)?;
    let db_file = db_path(&app)?;
    let images_dir = app_dir(&app)?.join("images");
    export_backup_inner(&db_file, &images_dir, Path::new(&target_path))
}

fn read_zip_entry(archive: &mut zip::ZipArchive<fs::File>, name: &str) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| format!("Missing zip entry {}: {}", name, e))?;
    let mut buf = Vec::new();
    entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(buf)
}

fn read_zip_entry_verified(
    archive: &mut zip::ZipArchive<fs::File>,
    name: &str,
    checksums: &HashMap<String, String>,
) -> Result<Vec<u8>, String> {
    let data = read_zip_entry(archive, name)?;
    let expected = checksums
        .get(name)
        .ok_or_else(|| format!("Missing checksum for {}", name))?;
    let actual = sha256_hex(&data);
    if actual != *expected {
        return Err(format!("Checksum mismatch for {}", name));
    }
    Ok(data)
}

fn import_backup_inner(
    db_file: &Path,
    images_dir: &Path,
    source: &Path,
    backup_dir: &Path,
) -> Result<ImportResult, String> {
    let file = fs::File::open(source).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;

    let manifest_bytes = read_zip_entry(&mut archive, "manifest.json")?;
    let manifest: BackupManifest = serde_json::from_slice(&manifest_bytes)
        .map_err(|e| format!("Invalid manifest.json: {}", e))?;
    if manifest.format != BACKUP_FORMAT {
        return Err(format!(
            "Not a TaskCanvas backup (format: {})",
            manifest.format
        ));
    }
    if manifest.format_version > BACKUP_FORMAT_VERSION {
        return Err(format!(
            "Backup format v{} is newer than this app supports (v{})",
            manifest.format_version, BACKUP_FORMAT_VERSION
        ));
    }
    if manifest.schema_version > BACKUP_SCHEMA_VERSION {
        return Err(format!(
            "Backup schema v{} is newer than this app supports (v{})",
            manifest.schema_version, BACKUP_SCHEMA_VERSION
        ));
    }

    let checksums_bytes = read_zip_entry(&mut archive, "checksums.json")?;
    let checksums: HashMap<String, String> = serde_json::from_slice(&checksums_bytes)
        .map_err(|e| format!("Invalid checksums.json: {}", e))?;

    let todos_bytes = read_zip_entry_verified(&mut archive, "data/todos.json", &checksums)?;
    let todos: Vec<Todo> =
        serde_json::from_slice(&todos_bytes).map_err(|e| format!("Invalid todos.json: {}", e))?;

    let board_bytes = read_zip_entry_verified(&mut archive, "data/board_items.json", &checksums)?;
    let board_items: Vec<BoardItem> = serde_json::from_slice(&board_bytes)
        .map_err(|e| format!("Invalid board_items.json: {}", e))?;

    let att_bytes = read_zip_entry_verified(&mut archive, "data/attachments.json", &checksums)?;
    let attachments_imported: Vec<Attachment> = serde_json::from_slice(&att_bytes)
        .map_err(|e| format!("Invalid attachments.json: {}", e))?;

    let backup_name = format!(
        "taskcanvas.sqlite3.bak-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%S")
    );
    let backup_path = backup_dir.join(&backup_name);
    if db_file.exists() {
        fs::copy(db_file, &backup_path)
            .map_err(|e| format!("Could not back up current DB: {}", e))?;
    }

    let mut adjusted_attachments: Vec<Attachment> = Vec::with_capacity(attachments_imported.len());
    let mut images_count: usize = 0;

    for a in &attachments_imported {
        let basename = Path::new(&a.local_path)
            .file_name()
            .ok_or_else(|| format!("Invalid attachment path in backup: {}", a.local_path))?
            .to_string_lossy()
            .to_string();
        let zip_name = format!("images/{}", basename);
        let data = read_zip_entry_verified(&mut archive, &zip_name, &checksums)?;
        let dest = images_dir.join(&basename);
        fs::write(&dest, &data).map_err(|e| format!("Cannot write image {}: {}", basename, e))?;
        let mut a2 = a.clone();
        a2.local_path = dest.to_string_lossy().to_string();
        adjusted_attachments.push(a2);
        images_count += 1;
    }

    let mut c = Connection::open(db_file).map_err(|e| e.to_string())?;
    c.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    let tx = c.transaction().map_err(|e| e.to_string())?;

    tx.execute("DELETE FROM board_items", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM attachments", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM todos", [])
        .map_err(|e| e.to_string())?;

    for t in &todos {
        tx.execute(
            "INSERT INTO todos (id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![t.id, t.title, t.description, if t.completed {1} else {0}, t.priority, t.due_date, t.tags, t.created_at, t.updated_at, t.deleted_at, t.sync_status, t.version],
        ).map_err(|e| e.to_string())?;
    }
    for a in &adjusted_attachments {
        tx.execute(
            "INSERT INTO attachments (id,todo_id,board_id,file_name,mime_type,local_path,width,height,size_bytes,created_at,updated_at,sync_status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![a.id, a.todo_id, a.board_id, a.file_name, a.mime_type, a.local_path, a.width, a.height, a.size_bytes, a.created_at, a.updated_at, a.sync_status],
        ).map_err(|e| e.to_string())?;
    }
    for b in &board_items {
        tx.execute(
            "INSERT INTO board_items (id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![b.id, b.board_id, b.item_type, b.ref_id, b.x, b.y, b.width, b.height, b.z_index, b.created_at, b.updated_at, b.sync_status],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(ImportResult {
        todos: todos.len(),
        board_items: board_items.len(),
        attachments: attachments_imported.len(),
        images: images_count,
        backup_path: backup_path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn import_backup(app: AppHandle, source_path: String) -> Result<ImportResult, String> {
    init_db_inner(&app)?;
    let db_file = db_path(&app)?;
    let images_dir = app_dir(&app)?.join("images");
    let backup_dir = app_dir(&app)?;
    import_backup_inner(&db_file, &images_dir, Path::new(&source_path), &backup_dir)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_db_inner(app.handle()).map_err(Box::<dyn std::error::Error>::from)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_db,
            list_todos,
            create_todo,
            update_todo,
            toggle_todo,
            delete_todo,
            restore_todo,
            list_board_items,
            upsert_board_item,
            delete_board_item,
            save_image_data_url,
            list_attachments,
            get_attachment_data_url,
            export_snapshot,
            export_backup,
            import_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running TaskCanvas");
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn sanitize_file_name_basic() {
        assert_eq!(sanitize_file_name("normal.png"), "normal.png");
        assert_eq!(sanitize_file_name("with space.jpg"), "with space.jpg");
        assert_eq!(
            sanitize_file_name("under_score-dash.gif"),
            "under_score-dash.gif"
        );
    }

    #[test]
    fn sanitize_file_name_drops_path_separators() {
        // Slashes and backslashes are filtered; dots are kept (valid filename char).
        assert_eq!(sanitize_file_name("../../etc/passwd"), "....etcpasswd");
        assert_eq!(sanitize_file_name("a/b\\c:d"), "abcd");
        assert_eq!(sanitize_file_name("name<>\"|?*.png"), "name.png");
    }

    #[test]
    fn sanitize_file_name_truncates_long() {
        let long = "a".repeat(200);
        let s = sanitize_file_name(&long);
        assert_eq!(s.len(), 96);
    }

    #[test]
    fn sanitize_file_name_strips_non_ascii() {
        assert_eq!(sanitize_file_name("\u{0e44}\u{0e17}\u{0e22}.png"), ".png");
    }

    #[test]
    fn parse_data_url_valid_png() {
        let data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==";
        let (mime, bytes) = parse_data_url(data_url).expect("valid PNG should parse");
        assert_eq!(mime, "image/png");
        assert!(!bytes.is_empty());
    }

    #[test]
    fn parse_data_url_missing_comma() {
        assert!(parse_data_url("data:image/png;base64").is_err());
    }

    #[test]
    fn parse_data_url_not_base64() {
        assert!(parse_data_url("data:image/png,hello").is_err());
    }

    #[test]
    fn parse_data_url_non_image_mime() {
        assert!(parse_data_url("data:text/plain;base64,aGVsbG8=").is_err());
    }

    #[test]
    fn parse_data_url_oversized_body() {
        let big = "A".repeat(MAX_BASE64_BODY_BYTES + 4);
        let url = format!("data:image/png;base64,{}", big);
        let err = parse_data_url(&url).expect_err("expected oversize rejection");
        assert!(err.contains("too large"), "unexpected error: {}", err);
    }

    #[test]
    fn sha256_hex_known_vectors() {
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn migrations_fresh_db_applies_all() {
        let mut c = Connection::open_in_memory().unwrap();
        let applied = run_migrations(&mut c).unwrap();
        assert_eq!(applied, MIGRATIONS.last().unwrap().version);

        let count: i64 = c.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('todos','attachments','board_items','schema_migrations')",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 4, "expected all core tables to exist");
    }

    #[test]
    fn migrations_idempotent() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        let first_count: i64 = c
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        run_migrations(&mut c).unwrap();
        let second_count: i64 = c
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            first_count, second_count,
            "re-running migrations should not duplicate rows"
        );
        assert_eq!(
            current_schema_version(&c).unwrap(),
            MIGRATIONS.last().unwrap().version
        );
    }

    #[test]
    fn migrations_preserve_data() {
        let mut c = Connection::open_in_memory().unwrap();
        run_migrations(&mut c).unwrap();
        c.execute(
            "INSERT INTO todos (id,title,created_at,updated_at) VALUES ('t1','hello','now','now')",
            [],
        )
        .unwrap();
        run_migrations(&mut c).unwrap();
        let title: String = c
            .query_row("SELECT title FROM todos WHERE id='t1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(title, "hello");
    }

    // --- Backup/restore integration tests ---

    fn setup_source_db(dir: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let db = dir.join("src.sqlite3");
        let images = dir.join("images");
        fs::create_dir_all(&images).unwrap();
        let mut c = Connection::open(&db).unwrap();
        run_migrations(&mut c).unwrap();

        c.execute(
            "INSERT INTO todos (id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version)
             VALUES ('todo-1','hello','desc',0,'high','2026-12-31','t1','2026-01-01','2026-01-01',NULL,'synced',2)",
            [],
        ).unwrap();
        c.execute(
            "INSERT INTO todos (id,title,description,completed,priority,due_date,tags,created_at,updated_at,deleted_at,sync_status,version)
             VALUES ('todo-trashed','gone','',1,'low',NULL,'','2026-01-02','2026-01-02','2026-01-03','pending_delete',3)",
            [],
        ).unwrap();

        let img_bytes: &[u8] = b"\x89PNG\r\n\x1a\nFAKE_IMAGE_DATA";
        let img_path = images.join("att-1.png");
        fs::write(&img_path, img_bytes).unwrap();
        c.execute(
            "INSERT INTO attachments (id,todo_id,board_id,file_name,mime_type,local_path,width,height,size_bytes,created_at,updated_at,sync_status)
             VALUES ('att-1','todo-1','main','att.png','image/png',?1,NULL,NULL,?2,'2026-01-01','2026-01-01','synced')",
            params![img_path.to_string_lossy().to_string(), img_bytes.len() as i64],
        ).unwrap();

        c.execute(
            "INSERT INTO board_items (id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status)
             VALUES ('bi-1','main','todo','todo-1',12.5,34.5,280.0,170.0,7,'2026-01-01','2026-01-01','synced')",
            [],
        ).unwrap();
        drop(c);
        (db, images)
    }

    fn empty_target_db(dir: &std::path::Path) -> (std::path::PathBuf, std::path::PathBuf) {
        let db = dir.join("dst.sqlite3");
        let images = dir.join("images");
        fs::create_dir_all(&images).unwrap();
        let mut c = Connection::open(&db).unwrap();
        run_migrations(&mut c).unwrap();
        drop(c);
        (db, images)
    }

    fn make_manifest_json(
        format: &str,
        format_version: u32,
        schema_version: u32,
        todos: usize,
        board: usize,
        atts: usize,
        imgs: usize,
    ) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "format": format,
            "format_version": format_version,
            "schema_version": schema_version,
            "app_version": "0.0.0-test",
            "exported_at": "2026-01-01T00:00:00Z",
            "counts": {"todos": todos, "board_items": board, "attachments": atts, "images": imgs}
        }))
        .unwrap()
    }

    fn write_zip(target: &std::path::Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(target).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            zip.start_file(*name, opts).unwrap();
            zip.write_all(data).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn backup_roundtrip_preserves_all_data() {
        let src_dir = tempfile::tempdir().unwrap();
        let (src_db, src_images) = setup_source_db(src_dir.path());
        let backup = src_dir.path().join("out.taskcanvas.zip");

        export_backup_inner(&src_db, &src_images, &backup).expect("export");
        assert!(backup.exists());
        assert!(backup.metadata().unwrap().len() > 0);

        let dst_dir = tempfile::tempdir().unwrap();
        let (dst_db, dst_images) = empty_target_db(dst_dir.path());
        let result =
            import_backup_inner(&dst_db, &dst_images, &backup, dst_dir.path()).expect("import");

        assert_eq!(result.todos, 2, "both regular and trashed todo restored");
        assert_eq!(result.board_items, 1);
        assert_eq!(result.attachments, 1);
        assert_eq!(result.images, 1);

        let c = Connection::open(&dst_db).unwrap();
        let title: String = c
            .query_row("SELECT title FROM todos WHERE id='todo-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(title, "hello");
        let priority: String = c
            .query_row("SELECT priority FROM todos WHERE id='todo-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(priority, "high");
        let due: Option<String> = c
            .query_row("SELECT due_date FROM todos WHERE id='todo-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(due.as_deref(), Some("2026-12-31"));
        let version: i64 = c
            .query_row("SELECT version FROM todos WHERE id='todo-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(version, 2);

        let deleted_at: Option<String> = c
            .query_row(
                "SELECT deleted_at FROM todos WHERE id='todo-trashed'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(deleted_at.is_some(), "soft-deleted todos must round-trip");

        let bx: f64 = c
            .query_row("SELECT x FROM board_items WHERE id='bi-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        let bz: i64 = c
            .query_row("SELECT z_index FROM board_items WHERE id='bi-1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!((bx - 12.5).abs() < 0.001);
        assert_eq!(bz, 7);

        let att_path: String = c
            .query_row(
                "SELECT local_path FROM attachments WHERE id='att-1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let restored = fs::read(&att_path).expect("image should exist at new path");
        assert_eq!(restored, b"\x89PNG\r\n\x1a\nFAKE_IMAGE_DATA");
        assert!(
            std::path::Path::new(&att_path).starts_with(&dst_images),
            "image must live under target images dir"
        );
    }

    #[test]
    fn import_creates_backup_of_existing_db_before_replace() {
        let src_dir = tempfile::tempdir().unwrap();
        let (src_db, src_images) = setup_source_db(src_dir.path());
        let backup_zip = src_dir.path().join("b.taskcanvas.zip");
        export_backup_inner(&src_db, &src_images, &backup_zip).unwrap();

        let dst_dir = tempfile::tempdir().unwrap();
        let (dst_db, dst_images) = empty_target_db(dst_dir.path());
        // Add a marker row that should disappear after import
        {
            let c = Connection::open(&dst_db).unwrap();
            c.execute(
                "INSERT INTO todos (id,title,created_at,updated_at) VALUES ('pre-existing','will be replaced','t','t')",
                [],
            ).unwrap();
        }
        let result =
            import_backup_inner(&dst_db, &dst_images, &backup_zip, dst_dir.path()).unwrap();

        let bak = std::path::Path::new(&result.backup_path);
        assert!(
            bak.exists(),
            "pre-import DB backup file should exist at {}",
            result.backup_path
        );
        assert!(bak
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("taskcanvas.sqlite3.bak-"));

        // The backup file should contain the pre-existing row
        let bak_conn = Connection::open(bak).unwrap();
        let pre_count: i64 = bak_conn
            .query_row(
                "SELECT COUNT(*) FROM todos WHERE id='pre-existing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(pre_count, 1, "backup must contain pre-import data");

        // The live DB no longer has it
        let live = Connection::open(&dst_db).unwrap();
        let live_count: i64 = live
            .query_row(
                "SELECT COUNT(*) FROM todos WHERE id='pre-existing'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(live_count, 0, "live DB should be replaced");
    }

    #[test]
    fn import_rejects_non_taskcanvas_format() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("bad.zip");
        write_zip(
            &zip_path,
            &[(
                "manifest.json",
                &make_manifest_json("evil-format", 1, 1, 0, 0, 0, 0),
            )],
        );
        let (db, images) = empty_target_db(dir.path());
        let err =
            import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
        assert!(err.contains("Not a TaskCanvas backup"), "got: {}", err);
    }

    #[test]
    fn import_rejects_newer_format_version() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("future.zip");
        write_zip(
            &zip_path,
            &[(
                "manifest.json",
                &make_manifest_json(BACKUP_FORMAT, BACKUP_FORMAT_VERSION + 1, 1, 0, 0, 0, 0),
            )],
        );
        let (db, images) = empty_target_db(dir.path());
        let err =
            import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
        assert!(
            err.contains("format v") && err.contains("newer"),
            "got: {}",
            err
        );
    }

    #[test]
    fn import_rejects_checksum_mismatch() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("tampered.zip");

        let todos_json: Vec<u8> = serde_json::to_vec::<Vec<Todo>>(&vec![]).unwrap();
        let board_json: Vec<u8> = serde_json::to_vec::<Vec<BoardItem>>(&vec![]).unwrap();
        let att_json: Vec<u8> = serde_json::to_vec::<Vec<Attachment>>(&vec![]).unwrap();

        // Inject wrong checksum for todos.json
        let mut checksums: HashMap<String, String> = HashMap::new();
        checksums.insert("data/todos.json".into(), "0".repeat(64));
        checksums.insert("data/board_items.json".into(), sha256_hex(&board_json));
        checksums.insert("data/attachments.json".into(), sha256_hex(&att_json));
        let ck_json = serde_json::to_vec(&checksums).unwrap();
        let manifest = make_manifest_json(BACKUP_FORMAT, 1, 1, 0, 0, 0, 0);

        write_zip(
            &zip_path,
            &[
                ("data/todos.json", &todos_json),
                ("data/board_items.json", &board_json),
                ("data/attachments.json", &att_json),
                ("checksums.json", &ck_json),
                ("manifest.json", &manifest),
            ],
        );

        let (db, images) = empty_target_db(dir.path());
        let err =
            import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
        assert!(err.contains("Checksum mismatch"), "got: {}", err);
    }

    #[test]
    fn import_strips_path_traversal_in_attachment_path() {
        let dir = tempfile::tempdir().unwrap();
        let zip_path = dir.path().join("slip.zip");

        let evil_attachment = serde_json::json!([{
            "id": "att-evil",
            "todo_id": null,
            "board_id": "main",
            "file_name": "evil.png",
            "mime_type": "image/png",
            "local_path": "images/../../escape-target.png",
            "width": null,
            "height": null,
            "size_bytes": 4,
            "created_at": "t",
            "updated_at": "t",
            "sync_status": "synced"
        }]);
        let att_json = serde_json::to_vec(&evil_attachment).unwrap();
        let todos_json: Vec<u8> = serde_json::to_vec::<Vec<Todo>>(&vec![]).unwrap();
        let board_json: Vec<u8> = serde_json::to_vec::<Vec<BoardItem>>(&vec![]).unwrap();
        let img: &[u8] = b"PNG\xff";

        let mut checksums: HashMap<String, String> = HashMap::new();
        checksums.insert("data/todos.json".into(), sha256_hex(&todos_json));
        checksums.insert("data/board_items.json".into(), sha256_hex(&board_json));
        checksums.insert("data/attachments.json".into(), sha256_hex(&att_json));
        checksums.insert("images/escape-target.png".into(), sha256_hex(img));
        let ck_json = serde_json::to_vec(&checksums).unwrap();
        let manifest = make_manifest_json(BACKUP_FORMAT, 1, 1, 0, 0, 1, 1);

        write_zip(
            &zip_path,
            &[
                ("data/todos.json", &todos_json),
                ("data/board_items.json", &board_json),
                ("data/attachments.json", &att_json),
                ("images/escape-target.png", img),
                ("checksums.json", &ck_json),
                ("manifest.json", &manifest),
            ],
        );

        let (db, images) = empty_target_db(dir.path());
        import_backup_inner(&db, &images, &zip_path, dir.path())
            .expect("import should succeed via basename normalization");

        let safe_dest = images.join("escape-target.png");
        assert!(safe_dest.exists(), "image must land inside images dir");
        // The path traversal target must NOT exist
        let escape_dest = dir.path().join("escape-target.png");
        assert!(!escape_dest.exists(), "must not write outside images dir");

        let stored_path: String = Connection::open(&db)
            .unwrap()
            .query_row(
                "SELECT local_path FROM attachments WHERE id='att-evil'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(std::path::Path::new(&stored_path).starts_with(&images));
    }

    #[test]
    fn export_rejects_attachment_outside_images_dir() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("src.sqlite3");
        let images = dir.path().join("images");
        let outside = dir.path().join("outside");
        fs::create_dir_all(&images).unwrap();
        fs::create_dir_all(&outside).unwrap();

        let outside_file = outside.join("not-allowed.png");
        fs::write(&outside_file, b"data").unwrap();

        {
            let mut c = Connection::open(&db).unwrap();
            run_migrations(&mut c).unwrap();
            c.execute(
                "INSERT INTO attachments (id,board_id,file_name,mime_type,local_path,size_bytes,created_at,updated_at,sync_status)
                 VALUES ('att-x','main','x.png','image/png',?1,4,'t','t','synced')",
                params![outside_file.to_string_lossy().to_string()],
            ).unwrap();
        }

        let target = dir.path().join("out.zip");
        let err = export_backup_inner(&db, &images, &target).expect_err("export must reject");
        assert!(err.contains("outside images directory"), "got: {}", err);
    }
}
