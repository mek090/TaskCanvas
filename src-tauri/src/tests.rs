use crate::attachments::{parse_data_url, sanitize_file_name, MAX_BASE64_BODY_BYTES};
use crate::backup::{
    export_backup_inner, import_backup_inner, sha256_hex, BACKUP_FORMAT, BACKUP_FORMAT_VERSION,
};
use crate::db::{current_schema_version, run_migrations, MIGRATIONS};
use crate::models::{Attachment, BoardItem, Todo};
use crate::todos::{list_todos_from_conn, purge_deleted_todos_inner, purge_todo_inner};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::fs;
use std::io::Write;

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

#[test]
fn list_todos_from_conn_orders_active_by_due_date_before_undated_then_done() {
    let mut c = Connection::open_in_memory().unwrap();
    run_migrations(&mut c).unwrap();
    c.execute(
        "INSERT INTO todos (id,title,completed,due_date,created_at,updated_at) VALUES ('later','later',0,'2026-05-20','t','2026-01-03')",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO todos (id,title,completed,due_date,created_at,updated_at) VALUES ('done-due','done due',1,'2026-05-01','t','2026-01-04')",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO todos (id,title,completed,due_date,created_at,updated_at) VALUES ('none','none',0,NULL,'t','2026-01-02')",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO todos (id,title,completed,due_date,created_at,updated_at) VALUES ('soon','soon',0,'2026-05-10','t','2026-01-01')",
        [],
    ).unwrap();

    let ids: Vec<String> = list_todos_from_conn(&c)
        .unwrap()
        .into_iter()
        .map(|todo| todo.id)
        .collect();

    assert_eq!(ids, vec!["soon", "later", "none", "done-due"]);
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
    let opts: zip::write::SimpleFileOptions =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
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
    let result = import_backup_inner(&dst_db, &dst_images, &backup_zip, dst_dir.path()).unwrap();

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
    let err = import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
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
    let err = import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
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
    let err = import_backup_inner(&db, &images, &zip_path, dir.path()).expect_err("must reject");
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
fn purge_todo_inner_hard_deletes_deleted_todo_and_linked_local_data() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("src.sqlite3");
    let images = dir.path().join("images");
    fs::create_dir_all(&images).unwrap();
    let image_path = images.join("purge-me.png");
    fs::write(&image_path, b"image").unwrap();

    let mut c = Connection::open(&db).unwrap();
    run_migrations(&mut c).unwrap();
    c.execute(
        "INSERT INTO todos (id,title,created_at,updated_at,deleted_at) VALUES ('trash-1','gone','t','t','t')",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO board_items (id,board_id,item_type,ref_id,x,y,width,height,z_index,created_at,updated_at,sync_status)
         VALUES ('board-trash','main','todo','trash-1',0,0,10,10,1,'t','t','pending_delete')",
        [],
    ).unwrap();
    c.execute(
        "INSERT INTO attachments (id,todo_id,board_id,file_name,mime_type,local_path,size_bytes,created_at,updated_at,sync_status)
         VALUES ('att-trash','trash-1','main','purge-me.png','image/png',?1,5,'t','t','pending_delete')",
        params![image_path.to_string_lossy().to_string()],
    ).unwrap();

    let purged = purge_todo_inner(&mut c, &images, "trash-1").unwrap();
    assert_eq!(purged.todos, 1);
    assert_eq!(purged.board_items, 1);
    assert_eq!(purged.attachments, 1);
    assert_eq!(purged.image_files, 1);
    assert!(
        !image_path.exists(),
        "linked attachment file should be removed"
    );

    for (table, expected) in [("todos", 0), ("board_items", 0), ("attachments", 0)] {
        let sql = format!("SELECT COUNT(*) FROM {}", table);
        let count: i64 = c.query_row(&sql, [], |r| r.get(0)).unwrap();
        assert_eq!(count, expected, "{} should be cleaned", table);
    }
}

#[test]
fn purge_deleted_todos_inner_cleans_orphan_attachments() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("src.sqlite3");
    let images = dir.path().join("images");
    fs::create_dir_all(&images).unwrap();
    let orphan_path = images.join("orphan.png");
    fs::write(&orphan_path, b"orphan").unwrap();

    let mut c = Connection::open(&db).unwrap();
    run_migrations(&mut c).unwrap();
    c.execute_batch("PRAGMA foreign_keys = OFF;").unwrap();
    c.execute(
        "INSERT INTO attachments (id,todo_id,board_id,file_name,mime_type,local_path,size_bytes,created_at,updated_at,sync_status)
         VALUES ('att-orphan','missing-todo','main','orphan.png','image/png',?1,6,'t','t','pending_delete')",
        params![orphan_path.to_string_lossy().to_string()],
    ).unwrap();

    let purged = purge_deleted_todos_inner(&mut c, &images).unwrap();
    assert_eq!(purged.todos, 0);
    assert_eq!(purged.attachments, 1);
    assert_eq!(purged.image_files, 1);
    assert!(
        !orphan_path.exists(),
        "orphan attachment file should be removed"
    );
    let count: i64 = c
        .query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
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
