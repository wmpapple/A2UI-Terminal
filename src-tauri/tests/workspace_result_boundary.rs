use a2ui_terminal_lib::{
    application::{result, workspace},
    storage::Storage,
};

#[test]
fn reading_saving_and_reopening_workspace_files_does_not_create_results() {
    let temp = tempfile::tempdir().unwrap();
    let db = temp.path().join("test.db");
    let work = temp.path().join("work");
    std::fs::create_dir(&work).unwrap();
    std::fs::write(work.join("notes.md"), "Source notes").unwrap();
    let storage = Storage::open(&db).unwrap();
    let registered = workspace::register(&storage, &work).unwrap();
    for _ in 0..2 {
        let document = workspace::read_file(&storage, &registered.id, "notes.md").unwrap();
        assert_eq!(document.content, "Source notes");
        assert!(result::list(&storage, None, true).unwrap().is_empty());
    }
    let document = workspace::read_file(&storage, &registered.id, "notes.md").unwrap();
    workspace::save_file(
        &storage,
        &registered.id,
        "notes.md",
        "Edited notes",
        &document.content_hash,
    )
    .unwrap();
    assert!(result::list(&storage, None, true).unwrap().is_empty());
    drop(storage);
    let storage = Storage::open(&db).unwrap();
    let reopened = workspace::read_file(&storage, &registered.id, "notes.md").unwrap();
    assert_eq!(reopened.content, "Edited notes");
    assert!(result::list(&storage, None, true).unwrap().is_empty());

    // Previously registered file results must remain usable after this fix.
    let existing = result::ensure_file_result(&storage, &registered.id, &reopened).unwrap();
    workspace::read_file(&storage, &registered.id, "notes.md").unwrap();
    assert_eq!(result::list(&storage, None, true).unwrap().len(), 1);
    let managed = result::prepare_managed_results_dir(temp.path()).unwrap();
    let existing = result::read_document(&storage, &managed, &existing.summary.id).unwrap();
    assert_eq!(existing.content, "Edited notes");
}

#[test]
fn workspace_read_command_only_reads_the_source() {
    // Guard the IPC boundary where the unintended registration originally happened.
    let commands = include_str!("../src/commands.rs");
    let body = commands
        .split("pub fn read_workspace_file(")
        .nth(1)
        .unwrap()
        .split("#[tauri::command]")
        .next()
        .unwrap();
    assert!(body.contains("workspace_service::read_file("));
    assert!(!body.contains("ensure_file_result"));
}
