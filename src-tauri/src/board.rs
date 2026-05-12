use crate::db::{conn, init_db_inner, now};
use crate::models::{BoardItem, BoardItemInput};
use rusqlite::params;
use tauri::AppHandle;
use uuid::Uuid;

#[tauri::command]
pub(crate) fn list_board_items(
    app: AppHandle,
    board_id: Option<String>,
) -> Result<Vec<BoardItem>, String> {
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
pub(crate) fn upsert_board_item(
    app: AppHandle,
    input: BoardItemInput,
) -> Result<BoardItem, String> {
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
pub(crate) fn delete_board_item(app: AppHandle, id: String) -> Result<(), String> {
    init_db_inner(&app)?;
    conn(&app)?
        .execute("DELETE FROM board_items WHERE id=?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
