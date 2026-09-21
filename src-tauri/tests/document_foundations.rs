use a2ui_terminal_lib::{
    application::{document, result},
    domain::{
        document::{DocumentSnapshot, DocumentTarget, SelectionSnapshot},
        result::{CreateTextResultInput, ResultType, SaveResultDocumentInput, TextResultFormat},
    },
    error::AppError,
    parser::{self, OffsetUnit, ParsedDocument},
    storage::Storage,
    workspace,
};
use std::{fs, path::Path};

fn selection(snapshot: &DocumentSnapshot, start: usize, end: usize) -> SelectionSnapshot {
    let range = document::utf16_range(&snapshot.text, start, end).unwrap();
    SelectionSnapshot {
        target: snapshot.target.clone(),
        revision_id: snapshot.revision_id.clone(),
        content_hash: snapshot.content_hash.clone(),
        start,
        end,
        offset_unit: OffsetUnit::Utf16,
        selected_text_hash: parser::hash(snapshot.text[range].as_bytes()),
    }
}

#[test]
fn shared_contract_preserves_unicode_crlf_hashes_and_rejects_path_fields() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../contracts/v2x/document.json")).unwrap();
    let snapshot: DocumentSnapshot = serde_json::from_value(fixture["snapshot"].clone()).unwrap();
    let selected: SelectionSnapshot = serde_json::from_value(fixture["selection"].clone()).unwrap();
    let parsed: ParsedDocument = serde_json::from_value(fixture["parsed"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap(),
        fixture["snapshot"]
    );
    assert_eq!(
        serde_json::to_value(&selected).unwrap(),
        fixture["selection"]
    );
    assert_eq!(
        parser::parse_bytes(Path::new("sample.txt"), snapshot.text.as_bytes()).unwrap(),
        parsed
    );
    let range = document::utf16_range(&snapshot.text, selected.start, selected.end).unwrap();
    assert_eq!(&snapshot.text[range.clone()], "🙂");
    assert_eq!(
        parser::hash(snapshot.text[range].as_bytes()),
        selected.selected_text_hash
    );
    for (start, end) in [(2, 3), (3, 4), (0, 100), (4, 4), (5, 1)] {
        assert!(document::utf16_range(&snapshot.text, start, end).is_err());
    }
    assert_eq!(
        &snapshot.text[document::utf16_range(&snapshot.text, 4, 8).unwrap()],
        "e\u{301}\r\n"
    );
    let mut bad = fixture["selection"].clone();
    bad["target"]["path"] = "C:/private.txt".into();
    assert!(serde_json::from_value::<SelectionSnapshot>(bad).is_err());
    let mut bad = fixture["selection"].clone();
    bad["offsetUnit"] = "bytes".into();
    assert!(serde_json::from_value::<SelectionSnapshot>(bad).is_err());
    let result_target: DocumentTarget =
        serde_json::from_value(fixture["resultTarget"].clone()).unwrap();
    assert_eq!(
        serde_json::to_value(result_target).unwrap(),
        fixture["resultTarget"]
    );
}

#[test]
fn authorized_source_rejects_cross_workspace_revocation_and_external_edits() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(&temp.path().join("db.sqlite3")).unwrap();
    let first = workspace::register_standalone_workspace(&storage).unwrap();
    let second = workspace::register_standalone_workspace(&storage).unwrap();
    let path = temp.path().join("text.txt");
    fs::write(&path, "中文🙂e\u{301}\r\nEnd").unwrap();
    let file = workspace::attach_selected_file(&storage, &first.id, &path).unwrap();
    let source_id = file.source_id.unwrap();
    let target = DocumentTarget::WorkspaceFile {
        workspace_id: first.id.clone(),
        source_id: source_id.clone(),
    };
    let current = document::snapshot(&storage, temp.path(), &target).unwrap();
    let selected = selection(&current, 2, 4);
    document::validate_selection(&storage, temp.path(), &selected).unwrap();
    let other = DocumentTarget::WorkspaceFile {
        workspace_id: second.id,
        source_id: source_id.clone(),
    };
    assert!(document::snapshot(&storage, temp.path(), &other).is_err());
    workspace::save_draft(
        &storage,
        &first.id,
        &file.path,
        "unsaved",
        &current.content_hash,
    )
    .unwrap();
    assert!(document::validate_selection(&storage, temp.path(), &selected).is_err());
    storage.delete_draft(&first.id, &file.path).unwrap();
    let mut forged = selected.clone();
    forged.selected_text_hash = parser::hash(b"other");
    assert!(matches!(
        document::validate_selection(&storage, temp.path(), &forged),
        Err(AppError::FileConflict)
    ));
    fs::write(&path, "external edit").unwrap();
    assert!(matches!(
        document::validate_selection(&storage, temp.path(), &selected),
        Err(AppError::FileConflict)
    ));
    storage
        .revoke_workspace_file(&first.id, &source_id)
        .unwrap();
    assert!(document::snapshot(&storage, temp.path(), &target).is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), "external edit");
}

#[test]
fn managed_result_resolves_revision_and_rejects_stale_selection_and_structured_target() {
    let temp = tempfile::tempdir().unwrap();
    let storage = Storage::open(&temp.path().join("db.sqlite3")).unwrap();
    let managed = result::prepare_managed_results_dir(temp.path()).unwrap();
    let created = result::create_text(
        &storage,
        &managed,
        CreateTextResultInput {
            title: "Sample".into(),
            file_name: "sample.txt".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::PlainText,
        },
    )
    .unwrap();
    let target = DocumentTarget::Result {
        result_id: created.result.summary.id.clone(),
    };
    let current = document::snapshot(&storage, &managed, &target).unwrap();
    let selected = selection(&current, 0, 6);
    document::validate_selection(&storage, &managed, &selected).unwrap();
    result::save_document(
        &storage,
        &managed,
        SaveResultDocumentInput {
            result_id: created.result.summary.id,
            base_hash: current.content_hash,
            content: "Changed".into(),
        },
    )
    .unwrap();
    assert!(matches!(
        document::validate_selection(&storage, &managed, &selected),
        Err(AppError::FileConflict)
    ));
    let table = result::create_text(
        &storage,
        &managed,
        CreateTextResultInput {
            title: "Table".into(),
            file_name: "table.csv".into(),
            result_type: ResultType::Spreadsheet,
            format: TextResultFormat::Csv,
        },
    )
    .unwrap();
    let table_target = DocumentTarget::Result {
        result_id: table.result.summary.id,
    };
    let table_snapshot = document::snapshot(&storage, &managed, &table_target).unwrap();
    assert!(!table_snapshot.editable);
    assert!(
        document::validate_selection(&storage, &managed, &selection(&table_snapshot, 0, 1))
            .is_err()
    );
    storage
        .delete_result_entry(match &target {
            DocumentTarget::Result { result_id } => result_id,
            _ => unreachable!(),
        })
        .unwrap();
    assert!(document::snapshot(&storage, &managed, &target).is_err());
}

#[test]
fn common_parser_keeps_limits_errors_and_does_not_invent_structural_locations() {
    assert!(matches!(
        parser::parse_bytes(Path::new("bad.txt"), &[255]),
        Err(AppError::InvalidEncoding)
    ));
    assert!(matches!(
        parser::parse_bytes(
            Path::new("large.txt"),
            &vec![b'x'; workspace::MAX_TEXT_FILE_BYTES as usize + 1]
        ),
        Err(AppError::FileTooLarge)
    ));
    assert!(parser::parse_bytes(Path::new("bad.docx"), b"not zip").is_err());
    assert!(parser::parse_bytes(Path::new("bad.pdf"), b"not pdf").is_err());
    assert!(parser::parse_bytes(Path::new("bad.exe"), b"text").is_err());
    let csv = parser::parse_bytes(Path::new("table.csv"), b"Name,Value\r\nA,=1+2\r\n").unwrap();
    assert_eq!(csv.text(), "Name\tValue\nA\t=1+2");
    assert_ne!(csv.raw_hash, csv.extracted_hash);
    assert!(matches!(
        csv.blocks[0].locator,
        parser::Locator::Unavailable { .. }
    ));
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("sample.docx");
    let file = fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(file);
    zip.start_file(
        "word/document.xml",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    std::io::Write::write_all(&mut zip,b"<w:document><w:p><w:r><w:t>Hello &amp; world</w:t></w:r></w:p><w:p><w:r><w:t>Next</w:t></w:r></w:p></w:document>").unwrap();
    zip.finish().unwrap();
    let parsed = parser::parse(&path).unwrap();
    let old = workspace::read_selected_file(&path, "test").unwrap();
    assert_eq!(parsed.text(), "Hello & world\nNext");
    assert_eq!(parsed.text(), old.content);
    assert_eq!(parsed.raw_hash, old.content_hash);
    assert!(matches!(
        parsed.blocks[0].locator,
        parser::Locator::Unavailable { .. }
    ));
    assert!(!old.editable);
}
