use crate::db::{app_dir, conn, init_db_inner, now};
use crate::models::Attachment;
use base64::{engine::general_purpose, Engine as _};
use rusqlite::params;
use std::fs;
use tauri::AppHandle;
use uuid::Uuid;

pub(crate) const MAX_IMAGE_BYTES: usize = 15 * 1024 * 1024;
pub(crate) const MAX_BASE64_BODY_BYTES: usize = MAX_IMAGE_BYTES / 3 * 4 + 4;

pub(crate) fn parse_data_url(data_url: &str) -> Result<(String, Vec<u8>), String> {
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

pub(crate) fn sanitize_file_name(name: &str) -> String {
    name.chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' '))
        .take(96)
        .collect::<String>()
        .trim()
        .to_string()
}

#[tauri::command]
pub(crate) fn save_image_data_url(
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
pub(crate) fn list_attachments(
    app: AppHandle,
    board_id: Option<String>,
) -> Result<Vec<Attachment>, String> {
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
pub(crate) fn get_attachment_data_url(app: AppHandle, id: String) -> Result<String, String> {
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
