//! Finite DOCX adapter. Never executes relationships or extracts archive paths.
use crate::{
    domain::structured_document::{Node, TextRun},
    error::AppError,
};
use base64::Engine;
use docx_rs::{BreakType, Docx, Paragraph, Pic, Run, Table, TableCell, TableRow};
use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use std::{
    collections::HashMap,
    io::{Cursor, Read},
};

fn invalid() -> AppError {
    AppError::InvalidInput("Word 文件结构无效或超出支持范围".into())
}

fn paragraph(runs: &[TextRun]) -> Paragraph {
    let mut p = Paragraph::new();
    for text in runs {
        let mut r = Run::new().add_text(&text.text);
        if text.bold {
            r = r.bold();
        }
        if text.italic {
            r = r.italic();
        }
        p = p.add_run(r);
    }
    p
}

pub fn png_dimensions(bytes: &[u8]) -> Result<(u32, u32), AppError> {
    if bytes.len() < 33
        || bytes.len() > 1024 * 1024
        || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || &bytes[12..16] != b"IHDR"
    {
        return Err(AppError::InvalidInput(
            "当前图片支持不超过 1 MiB 的 PNG".into(),
        ));
    }
    let w = u32::from_be_bytes(bytes[16..20].try_into().map_err(|_| invalid())?);
    let h = u32::from_be_bytes(bytes[20..24].try_into().map_err(|_| invalid())?);
    if w == 0 || h == 0 || w > 4096 || h > 4096 {
        return Err(AppError::InvalidInput("图片宽高需在 1–4096 像素内".into()));
    }
    Ok((w, h))
}

pub fn export(markdown: &str) -> Result<Vec<u8>, AppError> {
    let ast = super::structured_markdown::parse(markdown, None)?;
    let mut doc = Docx::new();
    for block in ast.blocks {
        match block.node {
            Node::Paragraph { runs } => doc = doc.add_paragraph(paragraph(&runs)),
            Node::Heading { level, runs } => {
                doc = doc.add_paragraph(paragraph(&runs).style(&format!("Heading{level}")))
            }
            Node::Quote { runs } => doc = doc.add_paragraph(paragraph(&runs).style("Quote")),
            Node::List { ordered, items } => {
                for (at, runs) in items.iter().enumerate() {
                    // Visible numbering is portable; nested numbering/style definitions are
                    // outside this adapter's first format matrix.
                    let prefix = if ordered {
                        format!("{}. ", at + 1)
                    } else {
                        "• ".into()
                    };
                    let mut all = vec![TextRun {
                        text: prefix,
                        bold: false,
                        italic: false,
                        code: false,
                    }];
                    all.extend(runs.clone());
                    doc = doc.add_paragraph(paragraph(&all).style("ListParagraph"));
                }
            }
            Node::Table { rows } => {
                doc = doc.add_table(Table::new(
                    rows.iter()
                        .map(|row| {
                            TableRow::new(
                                row.iter()
                                    .map(|cell| TableCell::new().add_paragraph(paragraph(cell)))
                                    .collect(),
                            )
                        })
                        .collect(),
                ));
            }
            Node::PageBreak => {
                doc = doc
                    .add_paragraph(Paragraph::new().add_run(Run::new().add_break(BreakType::Page)))
            }
            Node::Image { alt, source } => {
                if let Some(raw) = source.strip_prefix("data:image/png;base64,") {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(raw)
                        .map_err(|_| invalid())?;
                    let (w, h) = png_dimensions(&bytes)?;
                    let width = w.min(600);
                    let height = ((h as u64 * width as u64) / w as u64) as u32;
                    doc = doc.add_paragraph(Paragraph::new().add_run(
                        Run::new().add_image(Pic::new_with_dimensions(bytes, width, height)),
                    ));
                } else {
                    doc = doc.add_paragraph(
                        Paragraph::new()
                            .add_run(Run::new().add_text(format!("[图片：{alt}] {source}"))),
                    );
                }
            }
            Node::Unsupported { .. } => {
                doc = doc.add_paragraph(
                    Paragraph::new().add_run(Run::new().add_text(block.source.trim())),
                )
            }
        }
    }
    let mut output = Cursor::new(Vec::new());
    doc.build().pack(&mut output).map_err(|_| invalid())?;
    Ok(output.into_inner())
}

fn attr(tag: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    tag.attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| a.unescape_value().ok().map(|v| v.into_owned()))
}

fn entry(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<Vec<u8>, AppError> {
    let mut file = zip.by_name(path).map_err(|_| invalid())?;
    if file.size() > 8 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

pub fn import(bytes: &[u8]) -> Result<String, AppError> {
    if bytes.len() > 25 * 1024 * 1024 {
        return Err(invalid());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| invalid())?;
    if zip.len() > 2048 {
        return Err(invalid());
    }
    let mut total = 0u64;
    for at in 0..zip.len() {
        let file = zip.by_index(at).map_err(|_| invalid())?;
        total = total.checked_add(file.size()).ok_or_else(invalid)?;
        if total > 32 * 1024 * 1024 {
            return Err(invalid());
        }
    }
    let mut images = HashMap::new();
    if let Ok(rels) = entry(&mut zip, "word/_rels/document.xml.rels") {
        let mut reader = Reader::from_reader(rels.as_slice());
        loop {
            match reader.read_event().map_err(|_| invalid())? {
                Event::Empty(tag) | Event::Start(tag)
                    if tag.local_name().as_ref() == b"Relationship" =>
                {
                    if attr(&tag, b"TargetMode").as_deref() == Some("External") {
                        continue;
                    }
                    if let (Some(id), Some(target)) = (attr(&tag, b"Id"), attr(&tag, b"Target")) {
                        // Only an embedded PNG under word/media. No ../, drive, URI or FS.
                        if target.starts_with("media/")
                            && !target.contains("..")
                            && !target.contains(['\\', ':'])
                            && target.ends_with(".png")
                        {
                            if let Ok(data) = entry(&mut zip, &format!("word/{target}")) {
                                if png_dimensions(&data).is_ok() {
                                    images.insert(
                                        id,
                                        base64::engine::general_purpose::STANDARD.encode(data),
                                    );
                                }
                            }
                        }
                    }
                }
                Event::Eof => break,
                Event::DocType(_) => return Err(invalid()),
                _ => {}
            }
        }
    }
    let xml = entry(&mut zip, "word/document.xml")?;
    let mut reader = Reader::from_reader(xml.as_slice());
    let mut output = String::new();
    let mut p = String::new();
    let mut run = String::new();
    let (mut bold, mut italic, mut text, mut list) = (false, false, false, false);
    let mut style = String::new();
    let mut table_depth = 0;
    let mut row: Vec<String> = Vec::new();
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut cell = String::new();
    loop {
        match reader.read_event().map_err(|_| invalid())? {
            Event::Start(tag) | Event::Empty(tag) => match tag.local_name().as_ref() {
                b"tbl" => {
                    table_depth += 1;
                    if table_depth > 1 {
                        return Err(AppError::InvalidInput(
                            "暂不支持嵌套表格，请先在 Word 中转换为简单表格".into(),
                        ));
                    }
                    rows.clear();
                }
                b"tr" => row.clear(),
                b"tc" => cell.clear(),
                b"gridSpan" | b"vMerge" => {
                    return Err(AppError::InvalidInput(
                        "暂不支持合并单元格，请先在 Word 中拆分".into(),
                    ))
                }
                b"p" => {
                    p.clear();
                    style.clear();
                    list = false;
                }
                b"pStyle" => style = attr(&tag, b"val").unwrap_or_default(),
                b"numPr" => list = true,
                b"r" => {
                    run.clear();
                    bold = false;
                    italic = false;
                }
                b"b" => {
                    bold = !matches!(attr(&tag, b"val").as_deref(), Some("0" | "false" | "off"))
                }
                b"i" => {
                    italic = !matches!(attr(&tag, b"val").as_deref(), Some("0" | "false" | "off"))
                }
                b"t" => text = true,
                b"tab" => run.push(' '),
                b"br" => {
                    if attr(&tag, b"type").as_deref() == Some("page") {
                        run.push_str("\n\n<!-- pagebreak -->\n\n");
                    } else {
                        run.push('\n');
                    }
                }
                b"blip" => {
                    let image = attr(&tag, b"embed").and_then(|id| images.get(&id));
                    if let Some(image) = image {
                        run.push_str(&format!("\n\n![图片](data:image/png;base64,{image})\n\n"));
                    } else {
                        run.push_str("[不支持的图片或外部图片]");
                    }
                }
                _ => {}
            },
            Event::Text(value) if text => {
                let value = value.xml_content().map_err(|_| invalid())?;
                run.push_str(&super::structured_markdown::escape(
                    &quick_xml::escape::unescape(&value).map_err(|_| invalid())?,
                ));
            }
            Event::GeneralRef(reference) if text => {
                let name = reference.decode().map_err(|_| invalid())?;
                let resolved = quick_xml::escape::unescape(&format!("&{name};"))
                    .map_err(|_| invalid())?
                    .into_owned();
                run.push_str(&super::structured_markdown::escape(&resolved));
            }
            Event::End(tag) => match tag.local_name().as_ref() {
                b"t" => text = false,
                b"r" => {
                    if bold {
                        p.push_str("**");
                    }
                    if italic {
                        p.push('*');
                    }
                    p.push_str(&run);
                    if italic {
                        p.push('*');
                    }
                    if bold {
                        p.push_str("**");
                    }
                }
                b"p" => {
                    let heading = style
                        .strip_prefix("Heading")
                        .or_else(|| style.strip_prefix("heading"))
                        .and_then(|s| s.parse::<u8>().ok())
                        .filter(|n| (1..=6).contains(n));
                    let prefix = if let Some(level) = heading {
                        format!("{} ", "#".repeat(level as usize))
                    } else if style == "Quote" {
                        "> ".into()
                    } else if list {
                        "- ".into()
                    } else {
                        String::new()
                    };
                    // Our portable list paragraphs retain their visible markers on import.
                    if style == "ListParagraph" && p.starts_with('•') {
                        p = p.replacen('•', "-", 1);
                    }
                    if table_depth > 0 {
                        if !cell.is_empty() {
                            cell.push(' ');
                        }
                        cell.push_str(p.trim());
                    } else {
                        output.push_str(&format!("{prefix}{}\n\n", p.trim()));
                    }
                }
                b"tc" => row.push(cell.replace(['\n', '\r'], " ")),
                b"tr" => rows.push(row.clone()),
                b"tbl" => {
                    table_depth -= 1;
                    let columns = rows.first().map_or(0, Vec::len);
                    if columns == 0
                        || rows.len() > 200
                        || columns > 20
                        || rows.iter().any(|r| r.len() != columns)
                    {
                        return Err(invalid());
                    }
                    for (at, row) in rows.iter().enumerate() {
                        output.push_str(&format!("| {} |\n", row.join(" | ")));
                        if at == 0 {
                            output.push_str(&format!("| {} |\n", vec!["---"; columns].join(" | ")));
                        }
                    }
                    output.push('\n');
                }
                _ => {}
            },
            Event::DocType(_) => return Err(invalid()),
            Event::Eof => break,
            _ => {}
        }
        if output.len() + p.len() + run.len() > 2 * 1024 * 1024 {
            return Err(invalid());
        }
    }
    if table_depth != 0 {
        return Err(invalid());
    }
    super::structured_markdown::parse(&output, None)?;
    Ok(output)
}
