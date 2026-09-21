//! Offline, bounded Markdown-to-PDF layout. No HTML execution or remote resources.
use super::export::{repair_pdf_unicode, PDF_FONT};
use crate::error::AppError;
use printpdf::{Color, Mm, PdfDocument, Rgb, TextRenderingMode};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::io::Cursor;

const PDF_EMOJI_FONT: &[u8] = include_bytes!("../../assets/fonts/NotoEmoji-VF.ttf");

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Kind {
    #[default]
    Paragraph,
    Heading(u8),
    Code,
    Rule,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct Style {
    bold: bool,
    code: bool,
    font: usize,
}
#[derive(Clone, Debug)]
struct Span {
    text: String,
    style: Style,
}
#[derive(Clone, Debug, Default)]
struct Block {
    kind: Kind,
    spans: Vec<Span>,
    indent: f32,
    quote: bool,
    list: bool,
}
impl Block {
    fn push(&mut self, text: &str, style: Style) {
        if let Some(last) = self.spans.last_mut().filter(|last| last.style == style) {
            last.text.push_str(text);
        } else {
            self.spans.push(Span {
                text: text.into(),
                style,
            });
        }
    }
    fn size(&self) -> f32 {
        match self.kind {
            Kind::Heading(1) => 21.0,
            Kind::Heading(2) => 16.0,
            Kind::Heading(_) => 13.0,
            Kind::Code => 10.0,
            _ => 11.0,
        }
    }
}
fn flush(blocks: &mut Vec<Block>, current: &mut Block) {
    if !current.spans.is_empty() || current.kind == Kind::Rule {
        blocks.push(std::mem::take(current));
    }
}

fn markdown_blocks(content: &str) -> Vec<Block> {
    let mut blocks = Vec::new();
    let mut current = Block::default();
    let mut lists: Vec<Option<u64>> = Vec::new();
    let mut quote = 0_u32;
    let mut strong = 0_u32;
    let mut code = false;
    for event in Parser::new_ext(
        content,
        Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH,
    ) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                flush(&mut blocks, &mut current);
                current.kind = Kind::Heading(level as u8);
            }
            Event::End(TagEnd::Heading(_) | TagEnd::Paragraph | TagEnd::Item) => {
                flush(&mut blocks, &mut current)
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut blocks, &mut current);
                quote += 1;
            }
            Event::End(TagEnd::BlockQuote(_)) => {
                flush(&mut blocks, &mut current);
                quote = quote.saturating_sub(1);
            }
            Event::Start(Tag::List(start)) => {
                flush(&mut blocks, &mut current);
                lists.push(start);
            }
            Event::End(TagEnd::List(_)) => {
                flush(&mut blocks, &mut current);
                lists.pop();
            }
            Event::Start(Tag::Item) => {
                flush(&mut blocks, &mut current);
                current.list = true;
                current.indent = lists.len().saturating_sub(1).min(8) as f32 * 5.0;
                let marker = if let Some(Some(number)) = lists.last_mut() {
                    let marker = format!("{number}. ");
                    *number += 1;
                    marker
                } else {
                    "• ".into()
                };
                current.push(&marker, Style::default());
            }
            Event::Start(Tag::CodeBlock(_)) => {
                flush(&mut blocks, &mut current);
                current.kind = Kind::Code;
                code = true;
            }
            Event::End(TagEnd::CodeBlock) => {
                flush(&mut blocks, &mut current);
                code = false;
            }
            Event::Start(Tag::Strong) => strong += 1,
            Event::End(TagEnd::Strong) => strong = strong.saturating_sub(1),
            Event::Text(text) | Event::Html(text) | Event::InlineHtml(text) => {
                current.quote = quote > 0;
                current.push(
                    &text,
                    Style {
                        bold: strong > 0,
                        code,
                        ..Style::default()
                    },
                );
            }
            Event::Code(text) => current.push(
                &text,
                Style {
                    bold: strong > 0,
                    code: true,
                    ..Style::default()
                },
            ),
            Event::SoftBreak => current.push(" ", Style::default()),
            Event::HardBreak => current.push("\n", Style::default()),
            Event::Rule => {
                flush(&mut blocks, &mut current);
                blocks.push(Block {
                    kind: Kind::Rule,
                    ..Block::default()
                });
            }
            Event::TaskListMarker(done) => {
                current.push(if done { "[x] " } else { "[ ] " }, Style::default())
            }
            Event::Start(Tag::Image { .. }) => current.push("[图片: ", Style::default()),
            Event::End(TagEnd::Image) => current.push("]", Style::default()),
            Event::End(TagEnd::TableCell) => current.push(" | ", Style::default()),
            Event::End(TagEnd::TableHead | TagEnd::TableRow) => flush(&mut blocks, &mut current),
            _ => {}
        }
    }
    flush(&mut blocks, &mut current);
    blocks
}

#[derive(Clone, Copy)]
struct Glyph {
    ch: char,
    style: Style,
    width: f32,
}
#[derive(Debug)]
struct Row {
    spans: Vec<Span>,
    width: f32,
}
fn row(glyphs: &[Glyph]) -> Row {
    let mut block = Block::default();
    for glyph in glyphs {
        block.push(&glyph.ch.to_string(), glyph.style);
    }
    Row {
        spans: block.spans,
        width: glyphs.iter().map(|glyph| glyph.width).sum(),
    }
}
fn width(face: &ttf_parser::Face<'_>, ch: char, size: f32) -> Result<f32, AppError> {
    let glyph = face
        .glyph_index(ch)
        .filter(|glyph| glyph.0 != 0)
        .ok_or_else(|| {
            AppError::InvalidInput("PDF 字体未覆盖部分字符，请选择 DOCX、RTF 或原始格式导出".into())
        })?;
    Ok(
        face.glyph_hor_advance(glyph).unwrap_or(0) as f32 / face.units_per_em() as f32
            * size
            * 25.4
            / 72.0,
    )
}
fn wrap(
    block: &Block,
    faces: &[ttf_parser::Face<'_>],
    max_width: f32,
) -> Result<Vec<Row>, AppError> {
    let mut paragraphs = vec![Vec::new()];
    for span in &block.spans {
        for ch in span
            .text
            .replace('\t', "    ")
            .chars()
            .filter(|ch| *ch != '\r')
        {
            if ch == '\n' {
                paragraphs.push(Vec::new());
                continue;
            }
            let font = faces
                .iter()
                .position(|face| face.glyph_index(ch).is_some_and(|glyph| glyph.0 != 0))
                .ok_or_else(|| {
                    AppError::InvalidInput(format!(
                        "PDF 字体暂不支持字符 U+{:04X}，请选择 DOCX、RTF 或原始格式导出",
                        ch as u32
                    ))
                })?;
            paragraphs.last_mut().unwrap().push(Glyph {
                ch,
                style: Style { font, ..span.style },
                width: width(&faces[font], ch, block.size())?,
            });
        }
    }
    if block.kind == Kind::Code && paragraphs.last().is_some_and(Vec::is_empty) {
        paragraphs.pop();
    }
    let mut rows = Vec::new();
    for glyphs in paragraphs {
        if glyphs.is_empty() {
            rows.push(row(&[]));
            continue;
        }
        let mut start = 0;
        while start < glyphs.len() {
            let mut end = start;
            let mut used = 0.0;
            let mut boundary = None;
            while end < glyphs.len() && used + glyphs[end].width <= max_width {
                used += glyphs[end].width;
                if glyphs[end].ch == ' '
                    || (!glyphs[end].ch.is_ascii()
                        && glyphs.get(end + 1).is_none_or(|next| {
                            !"，。！？；：、）】》」』,.!?;:)]}".contains(next.ch)
                        }))
                {
                    boundary = Some(end + 1);
                }
                end += 1;
            }
            if end == start {
                return Err(AppError::InvalidInput("PDF 行宽不足".into()));
            }
            if end < glyphs.len() {
                end = boundary.filter(|value| *value > start).unwrap_or(end);
            }
            rows.push(row(&glyphs[start..end]));
            start = end;
        }
    }
    Ok(rows)
}

fn rectangle(layer: &printpdf::PdfLayerReference, x: f32, y: f32, w: f32, h: f32, shade: f32) {
    use printpdf::lopdf::content::Operation;
    layer.set_fill_color(Color::Rgb(Rgb::new(shade, shade, shade, None)));
    let pt = 72.0 / 25.4;
    layer.add_operation(Operation::new(
        "re",
        vec![
            (x * pt).into(),
            (y * pt).into(),
            (w * pt).into(),
            (h * pt).into(),
        ],
    ));
    layer.add_operation(Operation::new("f", vec![]));
}

pub fn generate(title: &str, content: &str, markdown: bool) -> Result<Vec<u8>, AppError> {
    let blocks = if markdown {
        markdown_blocks(content)
    } else {
        // Plain text and structured adapters preserve explicit newlines.
        vec![Block {
            spans: vec![Span {
                text: content.into(),
                style: Style::default(),
            }],
            ..Block::default()
        }]
    };
    let face = ttf_parser::Face::parse(PDF_FONT, 0)
        .map_err(|_| AppError::InvalidInput("PDF 字体无法加载".into()))?;
    let (document, mut page, mut layer_id) =
        PdfDocument::new(title, Mm(210.0), Mm(297.0), "Content");
    let needs_fallback = blocks
        .iter()
        .flat_map(|block| &block.spans)
        .flat_map(|span| span.text.chars())
        .filter(|ch| !matches!(ch, '\n' | '\r' | '\t'))
        .any(|ch| face.glyph_index(ch).is_none_or(|glyph| glyph.0 == 0));
    let mut font_data = vec![PDF_FONT];
    if needs_fallback {
        font_data.push(PDF_EMOJI_FONT);
    }
    let faces = font_data
        .iter()
        .map(|data| {
            ttf_parser::Face::parse(data, 0)
                .map_err(|_| AppError::InvalidInput("PDF 字体无法加载".into()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let fonts = font_data
        .iter()
        .map(|data| {
            document
                .add_external_font_with_subsetting(Cursor::new(*data), true)
                .map_err(|_| AppError::InvalidInput("PDF 字体无法加载".into()))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut y = 277.0_f32;
    let mut actual_text = Vec::new();
    for block in blocks {
        let size = block.size();
        let height = size * 25.4 / 72.0 * 1.5;
        let inset = block.indent
            + if block.quote || block.kind == Kind::Code {
                4.0
            } else {
                0.0
            };
        let rows = wrap(
            &block,
            &faces,
            174.0 - inset - if block.list { 4.0 } else { 0.0 },
        )?;
        if matches!(block.kind, Kind::Heading(_)) {
            y -= 3.5;
            // Keep the heading with at least one following line when possible.
            if y - height * (rows.len() as f32 + 1.0) < 20.0 {
                y = 0.0;
            }
        }
        if block.kind == Kind::Rule {
            if y < 24.0 {
                let next = document.add_page(Mm(210.0), Mm(297.0), "Content");
                page = next.0;
                layer_id = next.1;
                y = 277.0;
            }
            rectangle(
                &document.get_page(page).get_layer(layer_id),
                18.0,
                y,
                174.0,
                0.3,
                0.7,
            );
            y -= 4.0;
            continue;
        }
        for (index, row) in rows.iter().enumerate() {
            if y - height < 20.0 {
                let next = document.add_page(Mm(210.0), Mm(297.0), "Content");
                page = next.0;
                layer_id = next.1;
                y = 277.0;
            }
            let layer = document.get_page(page).get_layer(layer_id);
            if block.kind == Kind::Code {
                rectangle(
                    &layer,
                    18.0 + block.indent,
                    y - height * 0.35,
                    174.0 - block.indent,
                    height,
                    0.95,
                );
            }
            if block.quote {
                rectangle(
                    &layer,
                    18.0 + block.indent,
                    y - height * 0.35,
                    0.7,
                    height,
                    0.65,
                );
            }
            let mut x = 18.0 + inset + if block.list && index > 0 { 4.0 } else { 0.0 };
            debug_assert!(row.width <= 174.0 - inset + 0.01);
            for span in &row.spans {
                let span_width: f32 = span
                    .text
                    .chars()
                    .map(|ch| width(&faces[span.style.font], ch, size))
                    .collect::<Result<Vec<_>, _>>()?
                    .iter()
                    .sum();
                if span.style.code && block.kind != Kind::Code {
                    rectangle(
                        &layer,
                        x - 0.2,
                        y - 1.0,
                        span_width + 0.4,
                        height * 0.85,
                        0.94,
                    );
                }
                layer.set_fill_color(Color::Rgb(Rgb::new(0.06, 0.06, 0.06, None)));
                layer.set_outline_color(Color::Rgb(Rgb::new(0.06, 0.06, 0.06, None)));
                // The upstream VF default is light; a small text stroke improves
                // contrast without modifying/renaming the distributed font asset.
                layer.set_text_rendering_mode(TextRenderingMode::FillStroke);
                layer.set_outline_thickness(
                    if span.style.bold || matches!(block.kind, Kind::Heading(_)) {
                        0.32
                    } else {
                        0.12
                    },
                );
                layer.use_text(&span.text, size, Mm(x), Mm(y), &fonts[span.style.font]);
                actual_text.push(span.text.clone());
                x += span_width;
            }
            y -= height;
        }
        y -= if block.list { 1.0 } else { 3.0 };
    }
    let bytes = document
        .save_to_bytes()
        .map_err(|_| AppError::InvalidInput("PDF 成果无法导出".into()))?;
    repair_pdf_unicode(&bytes, &actual_text)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn acceptance_sample_preserves_emoji_combining_marks_and_chinese() {
        let content = include_str!("../../../docs/V2.X/M0_ACCEPTANCE_SAMPLES.md");
        let bytes = generate("M0 验收样本", content, true).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        for expected in ["🙂", "e\u{301}", "8 万元", "中文"] {
            assert!(text.contains(expected), "missing {expected:?}: {text:?}");
        }
        let pdf = printpdf::lopdf::Document::load_mem(&bytes).unwrap();
        assert!(
            pdf.objects
                .values()
                .filter_map(|object| object.as_dict().ok())
                .filter(|dict| dict.has(b"FontFile2"))
                .count()
                >= 2
        );
    }

    #[test]
    fn fallback_fonts_roundtrip_across_pages() {
        let content = "中文 🙂 hello 😀 e\u{301}\n".repeat(120);
        let bytes = generate("Mixed fonts", &content, false).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        for expected in ["中文", "🙂", "😀", "e\u{301}"] {
            assert_eq!(text.matches(expected).count(), 120, "{expected}");
        }
    }
    #[test]
    #[ignore = "writes a synthetic preview PDF under ignored target for visual acceptance"]
    fn write_manual_layout_preview() {
        let content = include_str!("../../../docs/S2_8_MANUAL_ACCEPTANCE.md");
        let bytes = generate("S2.8 排版验收", content, true).unwrap();
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/s2.8-pdf-layout-preview");
        std::fs::create_dir_all(&directory).unwrap();
        std::fs::write(directory.join("acceptance.pdf"), bytes).unwrap();
    }
    #[test]
    fn markdown_has_semantic_blocks_and_no_visible_fence_or_inline_markers() {
        let source = "# 标题\n\n> 引用 **重要内容**\n\n1. 安装 `npm run dev`\n2. 下一步\n\n```powershell\n$env:PATH = 'a'\n# literal\n```\n";
        let blocks = markdown_blocks(source);
        assert_eq!(blocks[0].kind, Kind::Heading(1));
        assert!(blocks.iter().any(|block| block.quote));
        assert!(blocks.iter().any(|block| block.kind == Kind::Code));
        let bytes = generate("排版测试", source, true).unwrap();
        let extracted = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(extracted.contains("标题"));
        assert!(extracted.contains("重要内容"));
        assert!(extracted.contains("# literal"));
        assert!(!extracted.contains("```"));
        assert!(!extracted.contains("**"));
        assert!(!extracted.contains('`'));
        assert!(!extracted.contains("> 引用"));
        let parsed = printpdf::lopdf::Document::load_mem(&bytes).unwrap();
        let content = parsed
            .get_page_content(*parsed.get_pages().values().next().unwrap())
            .unwrap();
        let operations = printpdf::lopdf::content::Content::decode(&content)
            .unwrap()
            .operations;
        assert!(operations.iter().any(|op| op.operator == "re"));
        let sizes: Vec<_> = operations
            .iter()
            .filter(|op| op.operator == "Tf")
            .map(|op| op.operands[1].as_float().unwrap())
            .collect();
        assert!(sizes.contains(&21.0));
        assert!(sizes.contains(&11.0));
        assert!(sizes.contains(&10.0));
    }
    #[test]
    fn wraps_by_real_width_and_keeps_plain_text_markers() {
        let face = ttf_parser::Face::parse(PDF_FONT, 0).unwrap();
        let block = Block {
            spans: vec![Span {
                text: "English words 中文段落，末尾标点。".repeat(40),
                style: Style::default(),
            }],
            ..Block::default()
        };
        assert!(wrap(&block, &[face], 174.0)
            .unwrap()
            .iter()
            .all(|row| row.width <= 174.0));
        let bytes = generate("plain", "# literal\n> literal\n`literal`", false).unwrap();
        let text = pdf_extract::extract_text_from_mem(&bytes).unwrap();
        assert!(text.contains("# literal"));
        assert!(text.contains("> literal"));
        assert!(text.contains("`literal`"));
    }
}
