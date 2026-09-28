use crate::error::AppError;
use std::{io::Read, path::Path};

pub(super) fn extract_document_text(path: &Path, bytes: &[u8]) -> Result<String, AppError> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("docx") => extract_docx_text(bytes),
        Some("pdf") => {
            let text = pdf_extract::extract_text_from_mem(bytes).map_err(|error| {
                AppError::InvalidInput(format!("Unable to extract PDF text: {error}"))
            })?;
            if text.trim().is_empty() {
                return Err(AppError::InvalidInput(
                    "This PDF has no extractable text layer; OCR is required".into(),
                ));
            }
            Ok(text)
        }
        _ => Err(AppError::InvalidInput("Unsupported document type".into())),
    }
}

fn extract_docx_text(bytes: &[u8]) -> Result<String, AppError> {
    Ok(extract_docx_paragraphs(bytes)?.trim().to_string())
}

pub(super) fn extract_docx_paragraphs(bytes: &[u8]) -> Result<String, AppError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| AppError::InvalidInput(format!("Invalid DOCX package: {error}")))?;
    let document = archive.by_name("word/document.xml").map_err(|_| {
        AppError::InvalidInput("DOCX package does not contain word/document.xml".into())
    })?;
    let mut xml = String::new();
    document
        .take(25 * 1024 * 1024 + 1)
        .read_to_string(&mut xml)
        .map_err(AppError::Io)?;
    if xml.len() > 25 * 1024 * 1024 {
        return Err(AppError::FileTooLarge);
    }
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut output = String::new();
    loop {
        match reader.read_event() {
            Ok(quick_xml::events::Event::Text(text)) => {
                let decoded = text.xml_content().map_err(|error| {
                    AppError::InvalidInput(format!("Invalid DOCX text: {error}"))
                })?;
                output.push_str(&decoded);
            }
            Ok(quick_xml::events::Event::GeneralRef(reference)) => {
                let entity = format!("&{};", String::from_utf8_lossy(reference.as_ref()));
                let decoded = quick_xml::escape::unescape(&entity).map_err(|error| {
                    AppError::InvalidInput(format!("Invalid DOCX entity: {error}"))
                })?;
                output.push_str(&decoded);
            }
            Ok(quick_xml::events::Event::End(end)) if end.name().as_ref() == b"w:p" => {
                output.push('\n');
            }
            Ok(quick_xml::events::Event::Eof) => break,
            Err(error) => {
                return Err(AppError::InvalidInput(format!(
                    "Unable to parse DOCX content: {error}"
                )))
            }
            _ => {}
        }
    }
    if output.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "This DOCX document contains no extractable body text".into(),
        ));
    }
    Ok(output.strip_suffix('\n').unwrap_or(&output).to_string())
}

pub(super) fn located_docx_paragraphs(bytes: &[u8]) -> Result<Vec<String>, AppError> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|_| AppError::InvalidInput("Invalid DOCX package".into()))?;
    let mut xml = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| AppError::InvalidInput("Missing DOCX body".into()))?
        .take(25 * 1024 * 1024 + 1)
        .read_to_string(&mut xml)?;
    if xml.len() > 25 * 1024 * 1024 {
        return Err(AppError::FileTooLarge);
    }
    let mut reader = quick_xml::Reader::from_str(&xml);
    let mut paragraphs = Vec::new();
    let mut current = String::new();
    let mut in_paragraph = false;
    let mut in_text = false;
    use quick_xml::events::Event;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"w:p" => {
                current.clear();
                in_paragraph = true;
            }
            Ok(Event::Start(e)) if e.name().as_ref() == b"w:t" => in_text = true,
            Ok(Event::End(e)) if e.name().as_ref() == b"w:t" => in_text = false,
            Ok(Event::End(e)) if e.name().as_ref() == b"w:p" => {
                paragraphs.push(std::mem::take(&mut current));
                in_paragraph = false;
            }
            Ok(Event::Empty(e)) if e.name().as_ref() == b"w:p" => paragraphs.push(String::new()),
            Ok(Event::Empty(e))
                if in_paragraph && matches!(e.name().as_ref(), b"w:br" | b"w:cr") =>
            {
                current.push('\n')
            }
            Ok(Event::Empty(e)) if in_paragraph && e.name().as_ref() == b"w:tab" => {
                current.push('\t')
            }
            Ok(Event::Text(text)) if in_paragraph && in_text => current.push_str(
                &text
                    .xml_content()
                    .map_err(|_| AppError::InvalidInput("Invalid DOCX text".into()))?,
            ),
            Ok(Event::GeneralRef(reference)) if in_paragraph && in_text => {
                let entity = format!("&{};", String::from_utf8_lossy(reference.as_ref()));
                current.push_str(
                    &quick_xml::escape::unescape(&entity)
                        .map_err(|_| AppError::InvalidInput("Invalid DOCX entity".into()))?,
                );
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::InvalidInput("Invalid DOCX XML".into())),
            _ => {}
        }
    }
    Ok(paragraphs)
}
