use crate::attachments::list_attachments;
use crate::board::list_board_items;
use crate::db::{app_dir, db_path, init_db_inner, now};
use crate::models::{Attachment, BoardItem, Todo};
use crate::todos::list_todos;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use tauri::AppHandle;

pub(crate) const BACKUP_FORMAT: &str = "taskcanvas.backup";
pub(crate) const BACKUP_FORMAT_VERSION: u32 = 1;
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
pub(crate) struct ImportResult {
    pub(crate) todos: usize,
    pub(crate) board_items: usize,
    pub(crate) attachments: usize,
    pub(crate) images: usize,
    pub(crate) backup_path: String,
}

pub(crate) fn sha256_hex(data: &[u8]) -> String {
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

pub(crate) fn export_backup_inner(
    db_file: &Path,
    images_dir: &Path,
    target: &Path,
) -> Result<(), String> {
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
pub(crate) fn export_backup(app: AppHandle, target_path: String) -> Result<(), String> {
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

pub(crate) fn import_backup_inner(
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
pub(crate) fn import_backup(app: AppHandle, source_path: String) -> Result<ImportResult, String> {
    init_db_inner(&app)?;
    let db_file = db_path(&app)?;
    let images_dir = app_dir(&app)?.join("images");
    let backup_dir = app_dir(&app)?;
    import_backup_inner(&db_file, &images_dir, Path::new(&source_path), &backup_dir)
}

#[tauri::command]
pub(crate) fn export_snapshot(app: AppHandle) -> Result<String, String> {
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
