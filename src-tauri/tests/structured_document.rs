use a2ui_terminal_lib::{
    application::{
        document, result, review, structured_document as app, structured_docx,
        structured_markdown as md,
    },
    domain::{
        document::DocumentTarget,
        result::{CreateTextResultInput, ResultType, SaveResultDocumentInput, TextResultFormat},
        review::{ApplyReviewInput, DecideReviewBlocksInput, ReviewBlockDecision},
        structured_document::{Node, StructuredOperation as Op, StructuredPatch},
    },
    state::AppState,
    storage::Storage,
};
use std::io::{Cursor, Read, Write};

fn setup(text: &str) -> (tempfile::TempDir, AppState, DocumentTarget) {
    let dir = tempfile::tempdir().unwrap();
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    let created = result::create_text(
        &state.storage,
        &state.managed_results_dir,
        CreateTextResultInput {
            title: "M8".into(),
            file_name: "m8.md".into(),
            result_type: ResultType::Document,
            format: TextResultFormat::Markdown,
        },
    )
    .unwrap();
    let target = DocumentTarget::Result {
        result_id: created.result.summary.id,
    };
    save(&state, &target, text);
    (dir, state, target)
}
fn save(state: &AppState, target: &DocumentTarget, text: &str) {
    let snap = document::snapshot(&state.storage, &state.managed_results_dir, target).unwrap();
    let DocumentTarget::Result { result_id } = target else {
        panic!()
    };
    result::save_document(
        &state.storage,
        &state.managed_results_dir,
        SaveResultDocumentInput {
            result_id: result_id.clone(),
            base_hash: snap.content_hash,
            content: text.into(),
        },
    )
    .unwrap();
}
fn proposal(
    state: &AppState,
    target: &DocumentTarget,
    operations: Vec<Op>,
) -> a2ui_terminal_lib::domain::review::ReviewRequest {
    let view = app::inspect(&state.storage, &state.managed_results_dir, target).unwrap();
    app::propose(
        &state.storage,
        &state.managed_results_dir,
        StructuredPatch {
            schema_version: 2,
            target: target.clone(),
            base_hash: view.snapshot.content_hash,
            base_revision_id: view.snapshot.revision_id,
            operations,
        },
    )
    .unwrap()
}
fn accept(state: &AppState, r: &a2ui_terminal_lib::domain::review::ReviewRequest) {
    review::decide(
        &state.storage,
        DecideReviewBlocksInput {
            workspace_id: r.workspace_id.clone(),
            review_id: r.id.clone(),
            decisions: r
                .blocks
                .iter()
                .map(|b| ReviewBlockDecision {
                    block_id: b.id.clone(),
                    accepted: true,
                    file_name: None,
                })
                .collect(),
        },
    )
    .unwrap();
}

#[test]
fn markdown_is_lossless_including_unknown_syntax_unicode_and_crlf() {
    let text="\r\n# 标题\r\n\r\n**预算** *420* 👋\r\n\r\n> 引用\r\n\r\n- 一\r\n- 二\r\n\r\n| 名称 | 说明 |\r\n| --- | --- |\r\n| A | B |\r\n\r\n![图](data:image/png;base64,AA==)\r\n\r\n<!-- pagebreak -->\r\n\r\n```rust\r\nlet a = 1;\r\n```\r\n\r\n";
    let ast = md::parse(text, None).unwrap();
    assert_eq!(md::render(&ast), text);
    assert_eq!(ast.blocks.len(), 8);
    assert!(matches!(ast.blocks[0].node, Node::Heading { level: 1, .. }));
    assert!(matches!(ast.blocks[4].node, Node::Table { .. }));
    assert!(matches!(ast.blocks[5].node, Node::Image { .. }));
    assert!(matches!(ast.blocks[6].node, Node::PageBreak));
    assert!(matches!(ast.blocks[7].node, Node::Unsupported { .. }));
}

#[test]
fn explicit_page_break_exports_as_two_pdf_pages() {
    use a2ui_terminal_lib::{application::export, domain::export::ExportFormat};
    let bytes = export::generate(
        ResultType::Document,
        TextResultFormat::Markdown,
        "分页",
        "前页\n\n<!-- pagebreak -->\n\n后页",
        ExportFormat::Pdf,
    )
    .unwrap();
    let pdf = printpdf::lopdf::Document::load_mem(&bytes).unwrap();
    assert_eq!(pdf.get_pages().len(), 2);
    let extracted = pdf_extract::extract_text_from_mem(&bytes).unwrap();
    assert!(extracted.contains("前页"));
    assert!(extracted.contains("后页"));
    assert!(!extracted.contains("pagebreak"));
}

#[test]
fn structured_operations_preserve_ids_and_unrelated_formatting() {
    let ast = md::parse(
        "# 标题\n\n段落\n\n| A | **B** |\n| --- | --- |\n| C | D |",
        None,
    )
    .unwrap();
    let changed = md::patch(
        &ast,
        &[
            Op::ChangeHeading {
                block_id: ast.blocks[0].id.clone(),
                level: 2,
            },
            Op::ReplaceBlock {
                block_id: ast.blocks[1].id.clone(),
                markdown: "**段落** *新内容*".into(),
            },
            Op::UpdateCell {
                block_id: ast.blocks[2].id.clone(),
                row: 1,
                column: 0,
                text: "E | F".into(),
            },
            Op::MoveBlock {
                block_id: ast.blocks[1].id.clone(),
                after_id: None,
            },
            Op::InsertBlock {
                after_id: Some(ast.blocks[2].id.clone()),
                markdown: "<!-- pagebreak -->".into(),
            },
        ],
    )
    .unwrap();
    assert_eq!(changed.blocks[0].id, ast.blocks[1].id);
    assert_eq!(changed.blocks[1].id, ast.blocks[0].id);
    assert!(md::render(&changed).contains("**B**"));
    assert!(md::render(&changed).contains("E \\| F"));
    let final_ast = md::patch(
        &changed,
        &[Op::DeleteBlock {
            block_id: changed.blocks[3].id.clone(),
        }],
    )
    .unwrap();
    assert_eq!(final_ast.blocks.len(), 3);
    assert!(md::patch(
        &ast,
        &[Op::ChangeHeading {
            block_id: ast.blocks[0].id.clone(),
            level: 7
        }]
    )
    .is_err());
    assert!(md::patch(
        &ast,
        &[Op::UpdateCell {
            block_id: ast.blocks[2].id.clone(),
            row: 100,
            column: 0,
            text: "bad".into()
        }]
    )
    .is_err());
    assert!(md::patch(
        &ast,
        &[Op::ReplaceText {
            block_id: "forged".into(),
            text: "bad".into()
        }]
    )
    .is_err());
}

#[test]
fn changing_structure_preserves_links_alignment_and_code_outside_the_target_cell() {
    let source="## [链接](https://example.test) `a`\n\n| A | [链接](https://example.test) |\n| :--- | ---: |\n| old | `code` |";
    let ast = md::parse(source, None).unwrap();
    let changed = md::patch(
        &ast,
        &[
            Op::ChangeHeading {
                block_id: ast.blocks[0].id.clone(),
                level: 3,
            },
            Op::UpdateCell {
                block_id: ast.blocks[1].id.clone(),
                row: 1,
                column: 0,
                text: "new".into(),
            },
        ],
    )
    .unwrap();
    let text = md::render(&changed);
    assert!(text.contains("### [链接](https://example.test) `a`"));
    assert!(text.contains("| A | [链接](https://example.test) |"));
    assert!(text.contains("| :--- | ---: |"));
    assert!(text.contains("| `code` |"));
    let ast = md::parse("## C#", None).unwrap();
    let changed = md::patch(
        &ast,
        &[Op::ChangeHeading {
            block_id: ast.blocks[0].id.clone(),
            level: 3,
        }],
    )
    .unwrap();
    assert_eq!(md::render(&changed).trim(), "### C#");
}

#[test]
fn structured_reviews_do_not_write_until_accepted_and_survive_restart() {
    let (dir, state, target) = setup("# M8\n\n预算 420 元，尚未批准。");
    let view = app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    let id = view.document.blocks[1].id.clone();
    let r = proposal(
        &state,
        &target,
        vec![Op::ReplaceText {
            block_id: id.clone(),
            text: "预算仍为 420 元，尚未批准。".into(),
        }],
    );
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .text,
        view.snapshot.text
    );
    assert!(review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id.clone(),
            review_id: r.id.clone()
        }
    )
    .is_err());
    accept(&state, &r);
    review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id.clone(),
            review_id: r.id.clone(),
        },
    )
    .unwrap();
    let updated = app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    assert_eq!(updated.document.blocks[1].id, id);
    assert_ne!(updated.snapshot.revision_id, view.snapshot.revision_id);
    drop(state);
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    assert_eq!(
        app::inspect(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .document,
        updated.document
    );
    review::undo(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id,
            review_id: r.id,
        },
    )
    .unwrap();
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .text,
        view.snapshot.text
    );
}

#[test]
fn stale_hash_and_same_text_new_revision_both_block_acceptance() {
    let (_dir, state, target) = setup("原文");
    let view = app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    let r = proposal(
        &state,
        &target,
        vec![Op::ReplaceText {
            block_id: view.document.blocks[0].id.clone(),
            text: "候选".into(),
        }],
    );
    accept(&state, &r);
    save(&state, &target, "外部变化");
    save(&state, &target, "原文");
    assert!(review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id,
            review_id: r.id
        }
    )
    .is_err());
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .text,
        "原文"
    );
    assert!(app::propose(
        &state.storage,
        &state.managed_results_dir,
        StructuredPatch {
            schema_version: 2,
            target,
            base_hash: "wrong".into(),
            base_revision_id: view.snapshot.revision_id,
            operations: vec![Op::DeleteBlock {
                block_id: view.document.blocks[0].id.clone()
            }]
        }
    )
    .is_err());
}

fn xml(bytes: &[u8]) -> String {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut s = String::new();
    zip.by_name("word/document.xml")
        .unwrap()
        .read_to_string(&mut s)
        .unwrap();
    s
}

#[test]
fn docx_roundtrip_keeps_first_stage_structures_and_marks() {
    let text="# 标题\n\n**预算** *420* 元，尚未批准。\n\n- 一\n- 二\n\n| 项目 | 金额 |\n| --- | --- |\n| A | **420** |\n\n> 引用\n\n<!-- pagebreak -->\n\n尾段";
    let bytes = structured_docx::export(text).unwrap();
    let xml = xml(&bytes);
    assert!(xml.contains("Heading1"));
    assert!(xml.contains("<w:tbl>"));
    assert!(xml.contains("w:type=\"page\""));
    let imported = structured_docx::import(&bytes).unwrap();
    assert!(imported.contains("# 标题"));
    assert!(imported.contains("**预算**"));
    assert!(imported.contains("*420*"));
    assert!(imported.contains("<!-- pagebreak -->"));
    assert!(imported.contains("| A | **420** |"));
    assert!(imported.contains("尚未批准"));
    assert!(imported.contains("- 一"));
    assert!(imported.contains("> 引用"));
    assert!(structured_docx::export(&imported).is_ok());
}

#[test]
fn embedded_png_roundtrips_without_external_access() {
    let image="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=";
    let text = format!("![图](data:image/png;base64,{image})");
    let bytes = structured_docx::export(&text).unwrap();
    let imported = structured_docx::import(&bytes).unwrap();
    assert!(imported.contains(image));
    let remote =
        structured_docx::export("![不请求网络](https://invalid.invalid/private.png)").unwrap();
    assert!(xml(&remote).contains("https://invalid.invalid/private.png"));
}

fn docx_xml(source: &str) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    zip.start_file(
        "word/document.xml",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(source.as_bytes()).unwrap();
    zip.finish().unwrap().into_inner()
}

#[test]
fn docx_rejects_lossy_merged_nested_or_unsafe_archives() {
    assert!(structured_docx::import(b"not zip").is_err());
    for xml in [
        "<w:document xmlns:w=\"x\"><w:tbl><w:tbl/></w:tbl></w:document>",
        "<w:document xmlns:w=\"x\"><w:tbl><w:gridSpan w:val=\"2\"/></w:tbl></w:document>",
        "<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///secret'>]><x>&y;</x>",
    ] {
        assert!(structured_docx::import(&docx_xml(xml)).is_err());
    }
}

#[test]
fn import_is_a_review_and_does_not_mutate_destination() {
    let (_dir, state, target) = setup("原始成果");
    let view = app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    let bytes = structured_docx::export("# 导入的报告\n\n预算 420 元").unwrap();
    let markdown = structured_docx::import(&bytes).unwrap();
    let r = app::propose_import(
        &state.storage,
        &state.managed_results_dir,
        &target,
        &view.snapshot.content_hash,
        &view.snapshot.revision_id,
        &markdown,
    )
    .unwrap();
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .text,
        "原始成果"
    );
    review::discard(&state.storage, &r.workspace_id, &r.id).unwrap();
    assert_eq!(
        document::snapshot(&state.storage, &state.managed_results_dir, &target)
            .unwrap()
            .text,
        "原始成果"
    );
}

#[test]
fn snapshots_are_cleared_with_local_data_and_foreign_keys_hold() {
    let (dir, state, target) = setup("文档");
    app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    let db = rusqlite::Connection::open(dir.path().join("test.db")).unwrap();
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM document_structures", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 1);
    state.storage.clear_all().unwrap();
    let count: i64 = db
        .query_row("SELECT COUNT(*) FROM document_structures", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    assert!(db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
}

#[test]
fn authorized_workspace_structure_edits_never_create_results_and_revocation_blocks_apply() {
    use a2ui_terminal_lib::application::workspace;
    let dir = tempfile::tempdir().unwrap();
    let files = dir.path().join("workspace");
    std::fs::create_dir(&files).unwrap();
    std::fs::write(files.join("source.md"), "# 原文件\n\n内容").unwrap();
    let state = AppState::new(
        Storage::open(&dir.path().join("test.db")).unwrap(),
        result::prepare_managed_results_dir(dir.path()).unwrap(),
    );
    let ws = workspace::register(&state.storage, &files).unwrap();
    let file = workspace::read_file(&state.storage, &ws.id, "source.md").unwrap();
    let target = DocumentTarget::WorkspaceFile {
        workspace_id: ws.id.clone(),
        source_id: file.document_id.unwrap(),
    };
    let view = app::inspect(&state.storage, &state.managed_results_dir, &target).unwrap();
    let r = proposal(
        &state,
        &target,
        vec![Op::ChangeHeading {
            block_id: view.document.blocks[0].id.clone(),
            level: 2,
        }],
    );
    accept(&state, &r);
    review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id,
            review_id: r.id,
        },
    )
    .unwrap();
    assert!(std::fs::read_to_string(files.join("source.md"))
        .unwrap()
        .contains("## 原文件"));
    assert!(result::list(&state.storage, None, true).unwrap().is_empty());
    assert!(state.storage.workspace_files(&ws.id).unwrap().is_empty());
    let r = proposal(
        &state,
        &target,
        vec![Op::DeleteBlock {
            block_id: view.document.blocks[1].id.clone(),
        }],
    );
    accept(&state, &r);
    std::fs::rename(files.join("source.md"), dir.path().join("outside.md")).unwrap();
    assert!(review::apply(
        &state.storage,
        &state.managed_results_dir,
        ApplyReviewInput {
            workspace_id: r.workspace_id,
            review_id: r.id
        }
    )
    .is_err());
    assert!(std::fs::read_to_string(dir.path().join("outside.md"))
        .unwrap()
        .contains("内容"));
}
