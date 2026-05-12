use chrono::Utc;
use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn app_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(dir.join("images")).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub(crate) fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_dir(app)?.join("taskcanvas.sqlite3"))
}

pub(crate) fn conn(app: &AppHandle) -> Result<Connection, String> {
    let c = Connection::open(db_path(app)?).map_err(|e| e.to_string())?;
    c.execute_batch(
        "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}

pub(crate) struct Migration {
    pub(crate) version: u32,
    pub(crate) name: &'static str,
    pub(crate) sql: &'static str,
}

pub(crate) const MIGRATIONS: &[Migration] = &[Migration {
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

pub(crate) fn ensure_migrations_table(c: &Connection) -> Result<(), String> {
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        );",
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn current_schema_version(c: &Connection) -> Result<u32, String> {
    ensure_migrations_table(c)?;
    c.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get::<_, u32>(0),
    )
    .map_err(|e| e.to_string())
}

pub(crate) fn run_migrations(c: &mut Connection) -> Result<u32, String> {
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

pub(crate) fn init_db_inner(app: &AppHandle) -> Result<(), String> {
    let _ = backup_db_for_migration(app)?;
    let mut c = conn(app)?;
    run_migrations(&mut c)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn init_db(app: AppHandle) -> Result<(), String> {
    init_db_inner(&app)
}
