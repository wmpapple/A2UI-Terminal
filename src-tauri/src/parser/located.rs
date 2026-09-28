use super::*;

pub const LOCATED_PARSER_VERSION: &str = "local-located-v2";

pub fn parse_located(path: &Path) -> Result<ParsedDocument, AppError> {
    parse_located_bytes(path, &read_bounded(path, limit(path)?)?)
}

pub fn parse_located_bytes(path: &Path, bytes: &[u8]) -> Result<ParsedDocument, AppError> {
    // Reuse the bounded archive validation before any structural extraction.
    let mut parsed = parse_bytes(path, bytes)?;
    let mut blocks = Vec::new();
    match parsed.format.as_str() {
        "pdf" => {
            match pdf_extract::extract_text_from_mem_by_pages(bytes) {
                Ok(pages) => {
                    for (index, text) in pages.into_iter().enumerate() {
                        blocks.push(ParsedBlock {
                            id: format!("page-{}", index + 1),
                            text,
                            locator: Locator::Page { page: index + 1 },
                        });
                    }
                }
                Err(_) => return Ok(parsed), // Explicit source-level fallback from v1.
            }
        }
        "docx" => {
            for (index, text) in text::located_docx_paragraphs(bytes)?
                .into_iter()
                .enumerate()
            {
                blocks.push(ParsedBlock {
                    id: format!("paragraph-{}", index + 1),
                    text,
                    locator: Locator::Paragraph {
                        paragraph: index + 1,
                    },
                });
            }
        }
        "csv" | "xlsx" => {
            if parsed.format == "xlsx" {
                let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
                    .map_err(|_| AppError::InvalidInput("XLSX 压缩包无效".into()))?;
                if archive.by_name("xl/_rels/workbook.xml.rels").is_err() {
                    return Ok(parsed); // No reliable sheet identity: source-level fallback.
                }
            }
            for (sheet_index, sheet) in table::parse_table_bytes(&parsed.format, bytes)?
                .sheets
                .into_iter()
                .enumerate()
            {
                for (index, row) in sheet.rows.into_iter().enumerate() {
                    let columns = row.len().max(1);
                    blocks.push(ParsedBlock {
                        id: format!("sheet-{}-row-{}", sheet_index + 1, index + 1),
                        text: row
                            .iter()
                            .map(|c| c.value.as_str())
                            .collect::<Vec<_>>()
                            .join("\t"),
                        locator: Locator::TableRange {
                            sheet: sheet.name.clone(),
                            start_row: index + 1,
                            end_row: index + 1,
                            start_column: 1,
                            end_column: columns,
                        },
                    });
                }
            }
        }
        _ => {
            // split('\n') preserves trailing empty lines and CRLF bytes when rejoined.
            let content = parsed.text();
            let lines = content.split('\n').collect::<Vec<_>>();
            for (index, chunk) in lines.chunks(20).enumerate() {
                blocks.push(ParsedBlock {
                    id: format!("lines-{}", index * 20 + 1),
                    text: chunk.join("\n"),
                    locator: Locator::Lines {
                        start_line: index * 20 + 1,
                        end_line: index * 20 + chunk.len(),
                    },
                });
            }
        }
    }
    parsed.blocks = blocks;
    if parsed.text().len() > MAX_TEXT_FILE_BYTES as usize {
        return Err(AppError::FileTooLarge);
    }
    parsed.extracted_hash = hash(parsed.text().as_bytes());
    parsed.parser_version = LOCATED_PARSER_VERSION.into();
    parsed.warnings.clear();
    Ok(parsed)
}
