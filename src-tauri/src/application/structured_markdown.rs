//! Markdown adapter. Unknown syntax remains an opaque, lossless source block.
use crate::{domain::structured_document::*, error::AppError};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

pub fn runs(source: &str) -> Vec<TextRun> {
    let mut output = Vec::new();
    let (mut bold, mut italic) = (0usize, 0usize);
    for event in Parser::new_ext(source, Options::ENABLE_TABLES) {
        match event {
            Event::Start(Tag::Strong) => bold += 1,
            Event::End(TagEnd::Strong) => bold = bold.saturating_sub(1),
            Event::Start(Tag::Emphasis) => italic += 1,
            Event::End(TagEnd::Emphasis) => italic = italic.saturating_sub(1),
            Event::Code(text) => output.push(TextRun {
                text: text.into_string(),
                bold: bold > 0,
                italic: italic > 0,
                code: true,
            }),
            Event::Text(text) => output.push(TextRun {
                text: text.into_string(),
                bold: bold > 0,
                italic: italic > 0,
                code: false,
            }),
            Event::SoftBreak | Event::HardBreak => output.push(TextRun {
                text: "\n".into(),
                bold: false,
                italic: false,
                code: false,
            }),
            _ => {}
        }
    }
    let mut merged: Vec<TextRun> = Vec::new();
    for run in output {
        if let Some(last) = merged.last_mut().filter(|last| {
            last.bold == run.bold && last.italic == run.italic && last.code == run.code
        }) {
            last.text.push_str(&run.text);
        } else {
            merged.push(run);
        }
    }
    merged
}

pub fn plain(runs: &[TextRun]) -> String {
    runs.iter().map(|run| run.text.as_str()).collect()
}

fn node(source: &str) -> Node {
    if source.trim() == "<!-- pagebreak -->" {
        return Node::PageBreak;
    }
    let events = Parser::new_ext(source, Options::ENABLE_TABLES).collect::<Vec<_>>();
    // Standalone image. Never fetch external URLs or resolve local file paths.
    if let Some(Event::Start(Tag::Image { dest_url, .. })) = events.get(1) {
        if events
            .iter()
            .filter(|e| matches!(e, Event::Start(Tag::Image { .. })))
            .count()
            == 1
            && matches!(
                events.get(events.len().saturating_sub(2)),
                Some(Event::End(TagEnd::Image))
            )
        {
            return Node::Image {
                alt: plain(&runs(source)),
                source: dest_url.to_string(),
            };
        }
    }
    match events.first() {
        Some(Event::Start(Tag::Heading { level, .. })) => Node::Heading {
            level: *level as u8,
            runs: runs(source),
        },
        Some(Event::Start(Tag::Paragraph)) => Node::Paragraph { runs: runs(source) },
        Some(Event::Start(Tag::BlockQuote(_))) => Node::Quote { runs: runs(source) },
        Some(Event::Start(Tag::List(start))) => {
            let mut nesting = 0usize;
            for event in &events {
                match event {
                    Event::Start(Tag::List(_)) => {
                        nesting += 1;
                        if nesting > 1 {
                            return Node::Unsupported {
                                label: "Nested list".into(),
                            };
                        }
                    }
                    Event::End(TagEnd::List(_)) => nesting = nesting.saturating_sub(1),
                    _ => {}
                }
            }
            let mut items = Vec::new();
            let mut item_start = None;
            for (event, range) in Parser::new_ext(source, Options::ENABLE_TABLES).into_offset_iter()
            {
                match event {
                    Event::Start(Tag::Item) => {
                        if item_start.is_none() {
                            item_start = Some(range.start);
                        }
                    }
                    Event::End(TagEnd::Item) => {
                        if let Some(start) = item_start.take() {
                            items.push(runs(&source[start..range.end]));
                        }
                    }
                    _ => {}
                }
            }
            Node::List {
                ordered: start.is_some(),
                items,
            }
        }
        Some(Event::Start(Tag::Table(_))) => {
            let mut rows = Vec::new();
            let mut row = Vec::new();
            let mut cell_start = 0;
            for (event, range) in Parser::new_ext(source, Options::ENABLE_TABLES).into_offset_iter()
            {
                match event {
                    Event::Start(Tag::TableCell) => cell_start = range.start,
                    Event::End(TagEnd::TableCell) => row.push(runs(&source[cell_start..range.end])),
                    Event::End(TagEnd::TableHead | TagEnd::TableRow) => {
                        rows.push(std::mem::take(&mut row))
                    }
                    _ => {}
                }
            }
            Node::Table { rows }
        }
        _ => Node::Unsupported {
            label: "Markdown".into(),
        },
    }
}

pub fn parse(
    source: &str,
    previous: Option<&StructuredDocument>,
) -> Result<StructuredDocument, AppError> {
    if source.len() > 2 * 1024 * 1024 {
        return Err(AppError::InvalidInput("文档超过 2 MiB".into()));
    }
    let mut depth = 0usize;
    let mut end = 0;
    let mut blocks = Vec::new();
    for (event, range) in Parser::new_ext(source, Options::ENABLE_TABLES).into_offset_iter() {
        let complete = match event {
            Event::Start(_) => {
                depth += 1;
                false
            }
            Event::End(_) => {
                depth = depth.saturating_sub(1);
                depth == 0
            }
            _ => depth == 0,
        };
        if complete && range.end > end {
            let raw = &source[end..range.end];
            blocks.push(Block {
                id: uuid::Uuid::new_v4().to_string(),
                node: node(raw),
                source: raw.into(),
            });
            end = range.end;
        }
    }
    if blocks.len() > 2000 {
        return Err(AppError::InvalidInput(
            "文档超过 2000 个结构块，请使用文本编辑".into(),
        ));
    }
    // Exact surviving blocks keep identity across insert/delete/move. Changed blocks
    // only inherit identity at an unclaimed matching position; duplicate blocks are
    // matched once, in order, rather than assigning content hashes as IDs.
    if let Some(previous) = previous {
        let mut used = std::collections::HashSet::new();
        let mut matched = vec![false; blocks.len()];
        for (at, block) in blocks.iter_mut().enumerate() {
            if let Some(old) = previous
                .blocks
                .iter()
                .find(|old| !used.contains(&old.id) && old.source.trim() == block.source.trim())
            {
                block.id.clone_from(&old.id);
                used.insert(old.id.clone());
                matched[at] = true;
            }
        }
        for (at, block) in blocks.iter_mut().enumerate() {
            if !matched[at] {
                if let Some(old) = previous
                    .blocks
                    .get(at)
                    .filter(|old| !used.contains(&old.id))
                {
                    block.id.clone_from(&old.id);
                    used.insert(old.id.clone());
                }
            }
        }
    }
    Ok(StructuredDocument {
        schema_version: 1,
        blocks,
        trailing: source[end..].into(),
    })
}

pub fn render(document: &StructuredDocument) -> String {
    let mut output = document
        .blocks
        .iter()
        .map(|b| b.source.as_str())
        .collect::<String>();
    output.push_str(&document.trailing);
    output
}

pub fn escape(text: &str) -> String {
    text.chars()
        .flat_map(|c| {
            if "\\`*_{}[]<>#!|".contains(c) {
                vec!['\\', c]
            } else {
                vec![c]
            }
        })
        .collect()
}

fn table(rows: &[Vec<String>]) -> Result<String, AppError> {
    let columns = rows.first().map_or(0, Vec::len);
    if rows.is_empty()
        || rows.len() > 200
        || columns == 0
        || columns > 20
        || rows.iter().any(|r| r.len() != columns)
    {
        return Err(AppError::InvalidInput(
            "表格需要 1–200 行、1–20 列，且各行列数相同".into(),
        ));
    }
    let mut source = String::new();
    for (at, row) in rows.iter().enumerate() {
        source.push_str(&format!(
            "| {} |\n",
            row.iter()
                .map(|v| escape(&v.replace(['\n', '\r'], " ")))
                .collect::<Vec<_>>()
                .join(" | ")
        ));
        if at == 0 {
            source.push_str(&format!("| {} |\n", vec!["---"; columns].join(" | ")));
        }
    }
    Ok(source)
}

pub fn patch(
    document: &StructuredDocument,
    operations: &[StructuredOperation],
) -> Result<StructuredDocument, AppError> {
    use StructuredOperation::*;
    if operations.is_empty() || operations.len() > 100 {
        return Err(AppError::InvalidInput("每次修改需要 1–100 项操作".into()));
    }
    let mut output = document.clone();
    for op in operations {
        let locate = |id: &str, blocks: &[Block]| {
            blocks
                .iter()
                .position(|b| b.id == id)
                .ok_or(AppError::FileConflict)
        };
        let insert_at = |id: &Option<String>, blocks: &[Block]| -> Result<usize, AppError> {
            id.as_ref()
                .map_or(Ok(0), |id| locate(id, blocks).map(|i| i + 1))
        };
        match op {
            ReplaceBlock { block_id, markdown } => {
                let at = locate(block_id, &output.blocks)?;
                let parsed = parse(markdown, None)?;
                if parsed.blocks.len() != 1 {
                    return Err(AppError::InvalidInput(
                        "请保留一个结构块；插入多个段落请分别操作".into(),
                    ));
                }
                output.blocks[at].node = parsed.blocks[0].node.clone();
                output.blocks[at].source = format!("\n\n{}\n\n", markdown.trim());
            }
            InsertBlock { after_id, markdown } => {
                let parsed = parse(markdown, None)?;
                if parsed.blocks.len() != 1 {
                    return Err(AppError::InvalidInput(
                        "请一次插入一个段落、列表、图片或分页块".into(),
                    ));
                }
                let mut block = parsed.blocks[0].clone();
                block.source = format!("\n\n{}\n\n", markdown.trim());
                let at = insert_at(after_id, &output.blocks)?;
                output.blocks.insert(at, block);
            }
            InsertTable { after_id, rows } => {
                let at = insert_at(after_id, &output.blocks)?;
                let raw = format!("\n\n{}\n", table(rows)?);
                output.blocks.insert(
                    at,
                    Block {
                        id: uuid::Uuid::new_v4().to_string(),
                        node: node(&raw),
                        source: raw,
                    },
                );
            }
            DeleteBlock { block_id } => {
                let at = locate(block_id, &output.blocks)?;
                output.blocks.remove(at);
            }
            MoveBlock { block_id, after_id } => {
                if after_id.as_deref() == Some(block_id) {
                    return Err(AppError::InvalidInput("不能移动到自身之后".into()));
                }
                let at = locate(block_id, &output.blocks)?;
                let mut block = output.blocks.remove(at);
                block.source = format!("\n\n{}\n\n", block.source.trim());
                let to = insert_at(after_id, &output.blocks)?;
                output.blocks.insert(to, block);
            }
            ReplaceText { block_id, text } => {
                let at = locate(block_id, &output.blocks)?;
                let raw = match &output.blocks[at].node {
                    Node::Heading { level, .. } => {
                        format!("{} {}", "#".repeat(*level as usize), escape(text))
                    }
                    Node::Paragraph { .. } => escape(text),
                    Node::Quote { .. } => text
                        .lines()
                        .map(|l| format!("> {}", escape(l)))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    _ => {
                        return Err(AppError::InvalidInput(
                            "替换文字只支持标题、段落和引用；表格请编辑单元格".into(),
                        ))
                    }
                };
                output.blocks[at].source = format!("\n\n{raw}\n\n");
                output.blocks[at].node = node(&raw);
            }
            ChangeHeading { block_id, level } => {
                if *level > 6 {
                    return Err(AppError::InvalidInput("标题级别必须为 0–6".into()));
                }
                let at = locate(block_id, &output.blocks)?;
                let original = output.blocks[at].source.trim();
                let text = match &output.blocks[at].node {
                    Node::Paragraph { .. } => original.to_string(),
                    Node::Heading { .. } => {
                        if original.starts_with('#') {
                            let title = original.trim_start_matches('#').trim();
                            if let Some(at) = title
                                .rfind(" #")
                                .filter(|at| title[at + 1..].chars().all(|c| c == '#'))
                            {
                                title[..at].trim_end().to_string()
                            } else {
                                title.to_string()
                            }
                        } else {
                            original
                                .lines()
                                .take(original.lines().count().saturating_sub(1))
                                .collect::<Vec<_>>()
                                .join("\n")
                        }
                    }
                    _ => return Err(AppError::InvalidInput("只能转换段落或标题".into())),
                };
                let raw = if *level == 0 {
                    text
                } else {
                    format!("{} {}", "#".repeat(*level as usize), text)
                };
                output.blocks[at].source = format!("\n\n{raw}\n\n");
                output.blocks[at].node = node(&raw);
            }
            UpdateCell {
                block_id,
                row,
                column,
                text,
            } => {
                let at = locate(block_id, &output.blocks)?;
                let Node::Table { .. } = &output.blocks[at].node else {
                    return Err(AppError::InvalidInput("目标不是表格".into()));
                };
                let mut raw = output.blocks[at].source.clone();
                let (mut r, mut c, mut start) = (0, 0, 0);
                let mut selected = None;
                for (event, range) in
                    Parser::new_ext(&raw, Options::ENABLE_TABLES).into_offset_iter()
                {
                    match event {
                        Event::Start(Tag::TableCell) => start = range.start,
                        Event::End(TagEnd::TableCell) => {
                            if r == *row && c == *column {
                                selected = Some(start..range.end);
                            }
                            c += 1;
                        }
                        Event::End(TagEnd::TableHead | TagEnd::TableRow) => {
                            r += 1;
                            c = 0;
                        }
                        _ => {}
                    }
                }
                raw.replace_range(
                    selected.ok_or(AppError::FileConflict)?,
                    &format!(" {} ", escape(&text.replace(['\n', '\r'], " "))),
                );
                output.blocks[at].source = raw.clone();
                output.blocks[at].node = node(&raw);
            }
        }
    }
    // Reparse candidates to ensure source and semantic structure agree. Preserve IDs.
    let source = render(&output);
    let checked = parse(&source, Some(&output))?;
    if checked.blocks.len() != output.blocks.len() {
        return Err(AppError::InvalidInput(
            "修改会合并或拆分结构块，请调整文字后重试".into(),
        ));
    }
    Ok(checked)
}
