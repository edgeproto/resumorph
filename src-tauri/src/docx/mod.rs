use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use std::io::{Read, Write};
use std::path::Path;
use thiserror::Error;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

#[derive(Debug, Error)]
pub enum DocxError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("XML parse error: {0}")]
    Xml(String),
    #[error("Document not found in DOCX archive")]
    DocumentNotFound,
}

pub fn extract_text(path: &std::path::Path) -> Result<String, DocxError> {
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;

    let mut document_xml = archive.by_name("word/document.xml")?;
    let mut xml = String::new();
    document_xml.read_to_string(&mut xml)?;

    Ok(extract_text_from_xml(&xml))
}

fn extract_text_from_xml(xml: &str) -> String {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut text = String::new();
    let mut in_text = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) if e.name().as_ref() == b"w:t" => {
                in_text = true;
            }
            Ok(Event::Text(e)) if in_text => {
                if let Ok(s) = e.unescape() {
                    text.push_str(&s);
                }
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"w:t" => {
                in_text = false;
            }
            Ok(Event::End(e)) if e.name().as_ref() == b"w:p" => {
                text.push('\n');
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return format!("{text}\n[parse warning: {e}]");
            }
            _ => {}
        }
    }

    normalize_whitespace(&text)
}

fn normalize_whitespace(text: &str) -> String {
    let lines: Vec<&str> = text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();
    lines.join("\n")
}

pub fn detect_placeholders(path: &Path) -> Result<Vec<String>, DocxError> {
    let file = std::fs::File::open(path)?;
    let mut archive = ZipArchive::new(file)?;

    let mut document_xml = archive.by_name("word/document.xml")?;
    let mut xml = String::new();
    document_xml.read_to_string(&mut xml)?;

    let re = Regex::new(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}").unwrap();
    let mut keys: Vec<String> = re
        .captures_iter(&xml)
        .map(|c| c[1].to_string())
        .collect();
    keys.sort();
    keys.dedup();
    Ok(keys)
}

/// Creates a copy of the DOCX with placeholder tags appended as new paragraphs.
pub fn inject_placeholders(
    source: &Path,
    dest: &Path,
    placeholders: &[String],
) -> Result<(), DocxError> {
    let file = std::fs::File::open(source)?;
    let mut archive = ZipArchive::new(file)?;

    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)?;
        let name = entry.name().to_string();
        let mut buf = Vec::new();
        entry.read_to_end(&mut buf)?;
        entries.push((name, buf));
    }

    if let Some((_, ref mut xml_bytes)) = entries
        .iter_mut()
        .find(|(name, _)| name == "word/document.xml")
    {
        let xml = String::from_utf8_lossy(xml_bytes);
        let injection: String = placeholders
            .iter()
            .map(|p| {
                format!(
                    "<w:p><w:r><w:t xml:space=\"preserve\">{{{}}}</w:t></w:r></w:p>",
                    p
                )
            })
            .collect();
        let modified = if let Some(pos) = xml.rfind("</w:body>") {
            format!("{}{}{}", &xml[..pos], injection, &xml[pos..])
        } else {
            xml.to_string()
        };
        *xml_bytes = modified.into_bytes();
    }

    let out_file = std::fs::File::create(dest)?;
    let mut zip = ZipWriter::new(out_file);
    let options = SimpleFileOptions::default();

    for (name, data) in entries {
        zip.start_file(name, options)?;
        zip.write_all(&data)?;
    }
    zip.finish()?;
    Ok(())
}
