use crate::document_source::escape_spreadsheet_formula;
pub use crate::domain::export::ExportFormat;
use crate::domain::export::ExportResultInput;
use crate::domain::result::{ResultDocument, ResultType, TextResultFormat};
use crate::error::AppError;
use crate::storage::Storage;
use csv::{ReaderBuilder, WriterBuilder};
use docx_rs::{Docx, Paragraph, Run};
use rust_xlsxwriter::Workbook;
use std::io::{Cursor, Write};
use std::path::Path;
use std::sync::atomic::{AtomicU8, Ordering};
use uuid::Uuid;

pub(super) const PDF_FONT: &[u8] = include_bytes!("../../assets/fonts/NotoSansSC-VF.ttf");

#[derive(Default)]
pub struct ExportCancellation(AtomicU8);

impl ExportCancellation {
    // 0: running, 1: cancelled, 2: committing/committed. Cancellation cannot
    // report success after the atomic file commit has started.
    pub fn cancel(&self) -> bool {
        self.0
            .compare_exchange(0, 1, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
            || self.0.load(Ordering::Acquire) == 1
    }

    pub fn check(&self) -> Result<(), AppError> {
        if self.0.load(Ordering::Acquire) == 1 {
            Err(AppError::RequestCancelled)
        } else {
            Ok(())
        }
    }

    pub(super) fn begin_commit(&self) -> Result<(), AppError> {
        self.0
            .compare_exchange(0, 2, Ordering::AcqRel, Ordering::Acquire)
            .map(|_| ())
            .map_err(|_| AppError::RequestCancelled)
    }
}

pub fn prepare(
    storage: &Storage,
    directory: &Path,
    input: &ExportResultInput,
) -> Result<ResultDocument, AppError> {
    Uuid::parse_str(&input.export_id)
        .map_err(|_| AppError::InvalidInput("导出任务标识无效".into()))?;
    let mut document = super::result::read_document(storage, directory, &input.result_id)?;
    if document.result.summary.a2ui_surface_id.is_some()
        && document.result.summary.current_revision_id.is_none()
    {
        return Err(AppError::InvalidInput(
            "该交互界面还没有可导出的工具结果".into(),
        ));
    }
    if !supported_formats(document.result.summary.result_type, document.format)
        .contains(&input.format)
    {
        return Err(AppError::InvalidInput(
            "该成果类型不支持所选导出格式".into(),
        ));
    }
    if document.result.summary.current_revision_id.as_deref() != Some(&input.revision_id) {
        return Err(AppError::FileConflict);
    }
    let revision =
        super::result::read_revision(storage, directory, &input.result_id, &input.revision_id)?;
    if !revision.summary.is_current || revision.summary.content_hash != document.content_hash {
        return Err(AppError::FileConflict);
    }
    document.content = revision.content;
    super::result::validate_result_content(document.result.summary.result_type, &document.content)?;
    Ok(document)
}

pub fn supported_formats(
    result_type: ResultType,
    source_format: TextResultFormat,
) -> Vec<ExportFormat> {
    match result_type {
        ResultType::Document => {
            let source = if source_format == TextResultFormat::Markdown {
                ExportFormat::Markdown
            } else {
                ExportFormat::PlainText
            };
            vec![
                source,
                ExportFormat::Docx,
                ExportFormat::Pdf,
                ExportFormat::Rtf,
            ]
        }
        ResultType::Spreadsheet => vec![ExportFormat::Csv, ExportFormat::Xlsx],
        ResultType::Checklist | ResultType::Form => vec![ExportFormat::Json, ExportFormat::Pdf],
        ResultType::Tool => vec![ExportFormat::Json],
    }
}

pub fn generate(
    result_type: ResultType,
    source_format: TextResultFormat,
    title: &str,
    content: &str,
    format: ExportFormat,
) -> Result<Vec<u8>, AppError> {
    super::result::validate_result_content(result_type, content)?;
    if !supported_formats(result_type, source_format).contains(&format) {
        return Err(AppError::InvalidInput(
            "该成果类型不支持所选导出格式".into(),
        ));
    }
    match format {
        ExportFormat::Markdown | ExportFormat::PlainText => Ok(content.as_bytes().to_vec()),
        ExportFormat::Json => {
            let value: serde_json::Value = serde_json::from_str(content)
                .map_err(|_| AppError::InvalidInput("成果 JSON 无法导出".into()))?;
            serde_json::to_vec_pretty(&value)
                .map_err(|_| AppError::InvalidInput("成果 JSON 无法导出".into()))
        }
        ExportFormat::Csv => safe_csv(content),
        ExportFormat::Xlsx => xlsx(content),
        ExportFormat::Docx => docx(content, source_format),
        ExportFormat::Pdf
            if result_type == ResultType::Document
                && source_format == TextResultFormat::Markdown =>
        {
            super::export_pdf::generate(title, content, true)
        }
        ExportFormat::Pdf => pdf(
            title,
            &printable_lines(result_type, source_format, content)?,
        ),
        ExportFormat::Rtf => Ok(rtf(content).into_bytes()),
    }
}

fn csv_rows(content: &str) -> Result<Vec<Vec<String>>, AppError> {
    ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .from_reader(content.as_bytes())
        .records()
        .map(|record| {
            record
                .map(|row| row.iter().map(escape_spreadsheet_formula).collect())
                .map_err(|_| AppError::InvalidInput("CSV 成果无法导出".into()))
        })
        .collect()
}

fn safe_csv(content: &str) -> Result<Vec<u8>, AppError> {
    let mut writer = WriterBuilder::new().flexible(true).from_writer(Vec::new());
    for row in csv_rows(content)? {
        writer
            .write_record(row)
            .map_err(|_| AppError::InvalidInput("CSV 成果无法导出".into()))?;
    }
    writer
        .into_inner()
        .map_err(|_| AppError::InvalidInput("CSV 成果无法导出".into()))
}

fn xlsx(content: &str) -> Result<Vec<u8>, AppError> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();
    for (row_index, row) in csv_rows(content)?.iter().enumerate() {
        let row_index = u32::try_from(row_index)
            .map_err(|_| AppError::InvalidInput("表格行数超出导出限制".into()))?;
        for (column_index, value) in row.iter().enumerate() {
            let column_index = u16::try_from(column_index)
                .map_err(|_| AppError::InvalidInput("表格列数超出导出限制".into()))?;
            worksheet
                .write_string(row_index, column_index, value)
                .map_err(|_| AppError::InvalidInput("XLSX 成果无法导出".into()))?;
        }
    }
    workbook
        .save_to_buffer()
        .map_err(|_| AppError::InvalidInput("XLSX 成果无法导出".into()))
}

fn docx(content: &str, source_format: TextResultFormat) -> Result<Vec<u8>, AppError> {
    let mut document = Docx::new();
    for line in content.lines() {
        let (text, heading) = document_line(line, source_format);
        let run = if heading {
            Run::new().add_text(text).bold().size(32)
        } else {
            Run::new().add_text(text)
        };
        document = document.add_paragraph(Paragraph::new().add_run(run));
    }
    let mut output = Cursor::new(Vec::new());
    document
        .build()
        .pack(&mut output)
        .map_err(|_| AppError::InvalidInput("DOCX 成果无法导出".into()))?;
    Ok(output.into_inner())
}

fn document_line(line: &str, format: TextResultFormat) -> (&str, bool) {
    if format == TextResultFormat::Markdown {
        let count = line.chars().take_while(|ch| *ch == '#').count();
        if (1..=6).contains(&count) && line.as_bytes().get(count) == Some(&b' ') {
            return (&line[count + 1..], true);
        }
    }
    (line, false)
}

fn printable_lines(
    result_type: ResultType,
    source_format: TextResultFormat,
    content: &str,
) -> Result<Vec<String>, AppError> {
    if matches!(
        result_type,
        ResultType::Checklist | ResultType::Form | ResultType::Tool
    ) {
        let value: serde_json::Value = serde_json::from_str(content)
            .map_err(|_| AppError::InvalidInput("结构化成果无法导出 PDF".into()))?;
        let mut lines = Vec::new();
        if let Some(items) = value["items"].as_array() {
            for item in items {
                lines.push(format!(
                    "[{}] {}",
                    if item["completed"].as_bool() == Some(true) {
                        "x"
                    } else {
                        " "
                    },
                    item["text"].as_str().unwrap_or_default()
                ));
            }
        }
        if let Some(fields) = value["fields"].as_array() {
            for field in fields {
                let marker = if field["required"].as_bool() == Some(true) {
                    " *"
                } else {
                    ""
                };
                lines.push(format!(
                    "{}{marker} ({})",
                    field["label"].as_str().unwrap_or_default(),
                    field["kind"].as_str().unwrap_or_default()
                ));
                lines.push("________________________________".into());
            }
        }
        return Ok(lines);
    }
    Ok(content
        .lines()
        .map(|line| document_line(line, source_format).0.to_string())
        .collect())
}

fn pdf(title: &str, lines: &[String]) -> Result<Vec<u8>, AppError> {
    super::export_pdf::generate(title, &lines.join("\n"), false)
}

// printpdf derives ToUnicode from the whole font cmap, which can choose a
// compatibility radical instead of the actual CJK character. Rebuild it from
// our own text operations after subsetting. Never silently drop missing glyphs.
pub(super) fn repair_pdf_unicode(bytes: &[u8], lines: &[String]) -> Result<Vec<u8>, AppError> {
    use printpdf::lopdf::{content::Content, Dictionary, Document, Object, Stream};
    let invalid = || AppError::InvalidInput("PDF 字符映射失败，请选择其他导出格式".into());
    let mut pdf = Document::load_mem(bytes).map_err(|_| invalid())?;
    let mut source = lines.iter();
    let mut mapping = std::collections::BTreeMap::new();
    for page in pdf.get_pages().values() {
        let content = pdf.get_page_content(*page).map_err(|_| invalid())?;
        for operation in Content::decode(&content).map_err(|_| invalid())?.operations {
            if operation.operator != "Tj" {
                continue;
            }
            let text = source.next().ok_or_else(invalid)?;
            let glyphs = operation
                .operands
                .first()
                .ok_or_else(invalid)?
                .as_str()
                .map_err(|_| invalid())?;
            if glyphs.len() != text.chars().count() * 2 {
                return Err(AppError::InvalidInput(
                    "PDF 字体未覆盖部分字符，请选择 DOCX、RTF 或原始格式导出".into(),
                ));
            }
            for (glyph, character) in glyphs.chunks_exact(2).zip(text.chars()) {
                let id = u16::from_be_bytes([glyph[0], glyph[1]]);
                if mapping
                    .insert(id, character)
                    .is_some_and(|previous| previous != character)
                {
                    return Err(invalid());
                }
            }
        }
    }
    if source.next().is_some() {
        return Err(invalid());
    }
    let mut cmap = String::from("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /A2UIUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n");
    let entries: Vec<_> = mapping.into_iter().collect();
    for block in entries.chunks(100) {
        cmap.push_str(&format!("{} beginbfchar\n", block.len()));
        for (glyph, character) in block {
            let mut units = [0; 2];
            let unicode = character
                .encode_utf16(&mut units)
                .iter()
                .map(|unit| format!("{unit:04X}"))
                .collect::<String>();
            cmap.push_str(&format!("<{glyph:04X}> <{unicode}>\n"));
        }
        cmap.push_str("endbfchar\n");
    }
    cmap.push_str("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n");
    let references: Vec<_> = pdf
        .objects
        .values()
        .filter_map(|object| {
            object
                .as_dict()
                .ok()?
                .get(b"ToUnicode")
                .ok()?
                .as_reference()
                .ok()
        })
        .collect();
    if !entries.is_empty() && references.is_empty() {
        return Err(invalid());
    }
    for reference in references {
        pdf.objects.insert(
            reference,
            Object::Stream(Stream::new(Dictionary::new(), cmap.as_bytes().to_vec())),
        );
    }
    let mut output = Vec::new();
    pdf.save_to(&mut output).map_err(AppError::Io)?;
    Ok(output)
}

fn rtf(content: &str) -> String {
    let escaped = content
        .replace('\\', "\\\\")
        .replace('{', "\\{")
        .replace('}', "\\}")
        .chars()
        .map(|character| {
            if character == '\n' {
                "\\par\n".to_string()
            } else if character.is_ascii() {
                character.to_string()
            } else {
                let mut units = [0_u16; 2];
                character
                    .encode_utf16(&mut units)
                    .iter()
                    .map(|unit| format!("\\u{}?", *unit as i16))
                    .collect::<String>()
            }
        })
        .collect::<String>();
    format!("{{\\rtf1\\ansi\\deff0 {escaped}}}")
}

pub fn write_atomic_new(
    path: &Path,
    bytes: &[u8],
    cancellation: &ExportCancellation,
) -> Result<(), AppError> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::InvalidInput("导出目标目录无效".into()))?;
    cancellation.check()?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".a2ui-export-")
        .suffix(".tmp")
        .tempfile_in(parent)?;
    for chunk in bytes.chunks(64 * 1024) {
        cancellation.check()?;
        temporary.write_all(chunk)?;
    }
    temporary.as_file().sync_all()?;
    cancellation.begin_commit()?;
    // Unlike exists()+rename(), this cannot replace a target created concurrently.
    temporary
        .persist_noclobber(path)
        .map(|_| ())
        .map_err(|failure| {
            if failure.error.kind() == std::io::ErrorKind::AlreadyExists {
                AppError::FileConflict
            } else {
                AppError::Io(failure.error)
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Read;

    fn archive_text(bytes: Vec<u8>, name: &str) -> String {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut text = String::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        text
    }

    #[test]
    fn exports_preserve_first_row_ragged_rows_quotes_and_empty_cells() {
        let input = "=header,name,empty\n\"a,b\",\"line1\nline2\",\nonly\n";
        let bytes = generate(
            ResultType::Spreadsheet,
            TextResultFormat::Csv,
            "table",
            input,
            ExportFormat::Csv,
        )
        .unwrap();
        let rows: Vec<_> = ReaderBuilder::new()
            .has_headers(false)
            .flexible(true)
            .from_reader(bytes.as_slice())
            .records()
            .map(Result::unwrap)
            .collect();
        assert_eq!(
            rows[0].iter().collect::<Vec<_>>(),
            vec!["'=header", "name", "empty"]
        );
        assert_eq!(
            rows[1].iter().collect::<Vec<_>>(),
            vec!["a,b", "line1\nline2", ""]
        );
        assert_eq!(rows[2].iter().collect::<Vec<_>>(), vec!["only"]);
        let xlsx = generate(
            ResultType::Spreadsheet,
            TextResultFormat::Csv,
            "table",
            input,
            ExportFormat::Xlsx,
        )
        .unwrap();
        let sheet = archive_text(xlsx.clone(), "xl/worksheets/sheet1.xml");
        let strings = archive_text(xlsx, "xl/sharedStrings.xml");
        assert!(sheet.contains("r=\"A1\""));
        assert!(sheet.contains("r=\"A3\""));
        assert!(!sheet.contains("<f>"));
        assert!(!sheet.contains("<hyperlink"));
        assert!(strings.contains("'=header"));
        assert!(strings.contains("a,b"));
        assert!(strings.contains("line1\nline2"));
    }

    #[test]
    fn plain_text_docx_preserves_hashes_whitespace_and_xml_characters() {
        let text = "#tag\n  indented <text> & value\n# literal";
        let xml = archive_text(
            docx(text, TextResultFormat::PlainText).unwrap(),
            "word/document.xml",
        );
        assert!(xml.contains("#tag"));
        assert!(xml.contains("  indented &lt;text&gt; &amp; value"));
        assert!(xml.contains("# literal"));
        assert_eq!(
            document_line("#tag", TextResultFormat::Markdown),
            ("#tag", false)
        );
        assert_eq!(
            document_line("# Title", TextResultFormat::Markdown),
            ("Title", true)
        );
        assert!(rtf("😀").contains("\\u-10179?\\u-8704?"));
    }

    #[test]
    fn pdf_embeds_truetype_and_roundtrips_chinese_across_pages() {
        let lines: Vec<String> = (0..85)
            .map(|i| format!("第{i}行 会议纪要 测试数据 ABC"))
            .collect();
        let bytes = pdf("验收", &lines).unwrap();
        let extracted = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(extracted.contains("第0行 会议纪要"), "{extracted:?}");
        assert!(extracted.contains("第84行 会议纪要"));
        let parsed = printpdf::lopdf::Document::load_mem(&bytes).unwrap();
        assert!(parsed.get_pages().len() >= 2);
        let mut found_font = false;
        for object in parsed.objects.values() {
            if let Ok(dictionary) = object.as_dict() {
                if let Ok(reference) = dictionary
                    .get(b"FontFile2")
                    .and_then(|value| value.as_reference())
                {
                    let stream = parsed.get_object(reference).unwrap().as_stream().unwrap();
                    let font = stream
                        .decompressed_content()
                        .unwrap_or_else(|_| stream.content.clone());
                    assert!(font.starts_with(&[0, 1, 0, 0]));
                    assert!(font.windows(4).any(|window| window == b"glyf"));
                    found_font = true;
                }
            }
        }
        assert!(found_font);
        assert!(pdf("unsupported", &["emoji 😀".into()]).is_err());
        assert!(pdf("tabs", &["a\tb".into()]).is_ok());
    }

    #[test]
    fn structured_export_rejects_debug_fields_and_prints_readable_items() {
        let content = r#"{"items":[{"id":"one","text":"待办任务","completed":true}]}"#;
        let bytes = generate(
            ResultType::Checklist,
            TextResultFormat::Json,
            "tasks",
            content,
            ExportFormat::Json,
        )
        .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["items"][0]["text"],
            "待办任务"
        );
        assert_eq!(
            printable_lines(ResultType::Checklist, TextResultFormat::Json, content).unwrap(),
            vec!["[x] 待办任务"]
        );
        let invalid = r#"{"items":[],"debug":{"prompt":"secret"}}"#;
        assert!(generate(
            ResultType::Checklist,
            TextResultFormat::Json,
            "tasks",
            invalid,
            ExportFormat::Json
        )
        .is_err());
        assert!(generate(
            ResultType::Checklist,
            TextResultFormat::Json,
            "tasks",
            content,
            ExportFormat::Xlsx
        )
        .is_err());
    }

    #[test]
    fn snapshot_rejects_cross_result_stale_revision_and_external_change() {
        use crate::domain::result::{CreateTextResultInput, SaveResultDocumentInput};
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage::open(&directory.path().join("state.sqlite")).unwrap();
        let managed = super::super::result::prepare_managed_results_dir(directory.path()).unwrap();
        let create = |name: &str| {
            super::super::result::create_text(
                &storage,
                &managed,
                CreateTextResultInput {
                    title: name.into(),
                    file_name: format!("{name}.md"),
                    result_type: ResultType::Document,
                    format: TextResultFormat::Markdown,
                },
            )
            .unwrap()
        };
        let first = create("first");
        let second = create("second");
        let mut input = ExportResultInput {
            export_id: Uuid::new_v4().to_string(),
            result_id: first.result.summary.id.clone(),
            revision_id: first.result.summary.current_revision_id.clone().unwrap(),
            format: ExportFormat::Markdown,
        };
        assert_eq!(
            prepare(&storage, &managed, &input).unwrap().content,
            first.content
        );
        input.revision_id = second.result.summary.current_revision_id.unwrap();
        assert!(prepare(&storage, &managed, &input).is_err());
        input.revision_id = first.result.summary.current_revision_id.unwrap();
        let saved = super::super::result::save_document(
            &storage,
            &managed,
            SaveResultDocumentInput {
                result_id: input.result_id.clone(),
                content: "new revision".into(),
                base_hash: first.content_hash,
            },
        )
        .unwrap();
        assert!(matches!(
            prepare(&storage, &managed, &input),
            Err(AppError::FileConflict)
        ));
        input.revision_id = saved.result.summary.current_revision_id.unwrap();
        assert_eq!(
            prepare(&storage, &managed, &input).unwrap().content,
            "new revision"
        );
        // Locate only the synthetic test result, without changing application files.
        let source = storage.result_source(&input.result_id).unwrap().unwrap();
        fs::write(managed.join(source.source_ref), "external edit").unwrap();
        assert!(matches!(
            prepare(&storage, &managed, &input),
            Err(AppError::FileConflict)
        ));
    }

    #[test]
    fn cancellation_and_concurrent_writers_leave_one_complete_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("export.txt");
        let cancellation = ExportCancellation::default();
        assert!(cancellation.cancel());
        assert!(matches!(
            write_atomic_new(&target, b"cancelled", &cancellation),
            Err(AppError::RequestCancelled)
        ));
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 0);
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = (*b"AB")
            .into_iter()
            .map(|byte| {
                let target = target.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    let cancellation = ExportCancellation::default();
                    let result = write_atomic_new(&target, &vec![byte; 128 * 1024], &cancellation);
                    assert!(!cancellation.cancel());
                    result.is_ok()
                })
            })
            .collect();
        assert_eq!(
            workers
                .into_iter()
                .map(|worker| usize::from(worker.join().unwrap()))
                .sum::<usize>(),
            1
        );
        let bytes = fs::read(&target).unwrap();
        assert_eq!(bytes.len(), 128 * 1024);
        assert!(bytes.iter().all(|byte| *byte == bytes[0]));
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn csv_and_xlsx_escape_formula_like_cells() {
        let input = "name,value\nattack,=CMD()\nsafe,42\n";
        let csv = String::from_utf8(safe_csv(input).unwrap()).unwrap();
        assert!(csv.contains("'=CMD()"));
        let xlsx = xlsx(input).unwrap();
        assert!(xlsx.starts_with(b"PK"));
        let mut archive = zip::ZipArchive::new(Cursor::new(xlsx)).unwrap();
        let mut shared_strings = String::new();
        archive
            .by_name("xl/sharedStrings.xml")
            .unwrap()
            .read_to_string(&mut shared_strings)
            .unwrap();
        assert!(shared_strings.contains("'=CMD()"));
        assert!(!shared_strings.contains("<f>"));
    }

    #[test]
    fn generators_emit_expected_signatures_and_utf8() {
        let text = "# 会议纪要\n\n你好，世界";
        assert!(docx(text, TextResultFormat::Markdown)
            .unwrap()
            .starts_with(b"PK"));
        assert!(pdf(
            "会议纪要",
            &printable_lines(ResultType::Document, TextResultFormat::Markdown, text).unwrap()
        )
        .unwrap()
        .starts_with(b"%PDF"));
        assert!(rtf(text).starts_with("{\\rtf1"));
    }

    #[test]
    fn atomic_export_refuses_overwrite_and_cleans_temporary_file() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("result.txt");
        write_atomic_new(&target, b"first", &ExportCancellation::default()).unwrap();
        assert!(matches!(
            write_atomic_new(&target, b"second", &ExportCancellation::default()),
            Err(AppError::FileConflict)
        ));
        assert_eq!(fs::read(target).unwrap(), b"first");
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
