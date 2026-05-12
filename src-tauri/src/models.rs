use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Todo {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) completed: bool,
    pub(crate) priority: String,
    pub(crate) due_date: Option<String>,
    pub(crate) tags: String,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) deleted_at: Option<String>,
    pub(crate) sync_status: String,
    pub(crate) version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BoardItem {
    pub(crate) id: String,
    pub(crate) board_id: String,
    pub(crate) item_type: String,
    pub(crate) ref_id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) z_index: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) sync_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct Attachment {
    pub(crate) id: String,
    pub(crate) todo_id: Option<String>,
    pub(crate) board_id: String,
    pub(crate) file_name: String,
    pub(crate) mime_type: String,
    pub(crate) local_path: String,
    pub(crate) width: Option<i64>,
    pub(crate) height: Option<i64>,
    pub(crate) size_bytes: i64,
    pub(crate) created_at: String,
    pub(crate) updated_at: String,
    pub(crate) sync_status: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub(crate) struct PurgeResult {
    pub(crate) todos: usize,
    pub(crate) board_items: usize,
    pub(crate) attachments: usize,
    pub(crate) image_files: usize,
}

impl PurgeResult {
    pub(crate) fn add(&mut self, other: PurgeResult) {
        self.todos += other.todos;
        self.board_items += other.board_items;
        self.attachments += other.attachments;
        self.image_files += other.image_files;
    }
}

#[derive(Debug, Deserialize)]
pub(crate) struct CreateTodoInput {
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    pub(crate) priority: Option<String>,
    pub(crate) due_date: Option<String>,
    pub(crate) tags: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct UpdateTodoInput {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) description: String,
    pub(crate) completed: bool,
    pub(crate) priority: String,
    pub(crate) due_date: Option<String>,
    pub(crate) tags: String,
}

#[derive(Debug, Deserialize)]
pub(crate) struct BoardItemInput {
    pub(crate) id: Option<String>,
    pub(crate) board_id: Option<String>,
    pub(crate) item_type: String,
    pub(crate) ref_id: String,
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) width: f64,
    pub(crate) height: f64,
    pub(crate) z_index: Option<i64>,
}
