use a2ui_terminal_lib::application::canvas::{self, CreateCanvasInput, SaveCanvasInput};
use a2ui_terminal_lib::error::AppError;
use a2ui_terminal_lib::storage::Storage;
use serde_json::json;

#[test]
fn spatial_canvas_persists_and_is_workspace_scoped() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("canvas.sqlite3");
    let storage = Storage::open(&path).unwrap();
    storage
        .create_standalone_workspace("workspace-one", "One")
        .unwrap();
    storage
        .create_standalone_workspace("workspace-two", "Two")
        .unwrap();
    let created = canvas::create(
        &storage,
        CreateCanvasInput {
            workspace_id: "workspace-one".into(),
            title: "论文流程".into(),
            binding: json!({"type":"file","path":"paper.pdf"}),
        },
    )
    .unwrap();
    assert!(created.blocks.is_empty());
    let saved = canvas::save(&storage, SaveCanvasInput {
        workspace_id: "workspace-one".into(), id: created.id.clone(), version: created.version,
        title: created.title.clone(), binding: created.binding.clone(),
        blocks: vec![json!({"id":"node-1","type":"note","title":"方法","body":"阅读记录","x":120,"y":80,"width":280,"height":190,"zIndex":1})],
        edges: vec![], viewport: json!({"x":24,"y":-10,"zoom":0.75}),
    }).unwrap();
    assert_eq!(saved.version, 2);
    assert_eq!(saved.blocks[0]["x"], 120);
    assert_eq!(saved.viewport["zoom"], 0.75);
    assert!(canvas::list(&storage, "workspace-two").unwrap().is_empty());
    let stale = canvas::save(
        &storage,
        SaveCanvasInput {
            workspace_id: "workspace-one".into(),
            id: created.id.clone(),
            version: 1,
            title: "冲突写入".into(),
            binding: created.binding,
            blocks: vec![],
            edges: vec![],
            viewport: json!({"x":0,"y":0,"zoom":1}),
        },
    );
    assert!(matches!(stale, Err(AppError::FileConflict)));
    drop(storage);
    let reopened = Storage::open(&path).unwrap();
    let found = canvas::read(&reopened, "workspace-one", &created.id).unwrap();
    assert_eq!(found.blocks[0]["body"], "阅读记录");
    assert_eq!(found.title, "论文流程");
    assert!(canvas::delete(&reopened, "workspace-one", &created.id).unwrap());
    assert!(canvas::list(&reopened, "workspace-one").unwrap().is_empty());
}
