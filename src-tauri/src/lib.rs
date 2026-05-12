mod attachments;
mod backup;
mod board;
mod db;
mod models;
mod todos;

#[cfg(test)]
mod tests;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            db::init_db_inner(app.handle()).map_err(Box::<dyn std::error::Error>::from)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            todos::list_todos,
            todos::list_deleted_todos,
            todos::create_todo,
            todos::update_todo,
            todos::toggle_todo,
            todos::delete_todo,
            todos::restore_todo,
            todos::purge_todo,
            todos::purge_deleted_todos,
            board::list_board_items,
            board::upsert_board_item,
            board::delete_board_item,
            attachments::save_image_data_url,
            attachments::list_attachments,
            attachments::get_attachment_data_url,
            backup::export_snapshot,
            backup::export_backup,
            backup::import_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running TaskCanvas");
}
