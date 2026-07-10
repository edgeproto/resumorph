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

const EXPORT_PLACEHOLDERS: &[&str] = &[
    "name",
    "contact",
    "summary",
    "experience",
    "skills",
    "education",
    "cover_letter",
];

/// Embed `{placeholder}` tags into section bodies so export keeps the original DOCX styles.
pub fn prepare_export_template(source: &Path, dest: &Path) -> Result<(), DocxError> {
    let existing = detect_placeholders(source)?;
    if EXPORT_PLACEHOLDERS
        .iter()
        .all(|k| existing.contains(&(*k).to_string()))
    {
        if source != dest {
            std::fs::copy(source, dest)?;
        }
        return Ok(());
    }

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
        let patched = patch_document_xml_for_export(&xml);
        *xml_bytes = patched.into_bytes();
    }

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
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

fn paragraph_text(chunk: &str) -> String {
    let re = Regex::new(r"<w:t[^>]*>([^<]*)</w:t>").unwrap();
    re.captures_iter(chunk)
        .map(|c| c[1].to_string())
        .collect::<Vec<_>>()
        .join("")
}

fn section_key_for_header(text: &str) -> Option<&'static str> {
    let t = text.trim().to_lowercase();
    if t.contains("summary") || t == "profile" || t.contains("objective") {
        return Some("summary");
    }
    if t.contains("experience") || t.contains("employment") {
        return Some("experience");
    }
    if t.contains("skill") {
        return Some("skills");
    }
    if t.contains("education") {
        return Some("education");
    }
    None
}

fn placeholder_paragraph(placeholder: &str, style_source: &str) -> String {
    let ppr_re = Regex::new(r"<w:pPr>[\s\S]*?</w:pPr>").unwrap();
    let ppr = ppr_re
        .find(style_source)
        .map(|m| m.as_str())
        .unwrap_or("");
    format!(
        "<w:p>{ppr}<w:r><w:t xml:space=\"preserve\">{{{placeholder}}}</w:t></w:r></w:p>"
    )
}

fn patch_document_xml_for_export(xml: &str) -> String {
    let Some(body_start) = xml.find("<w:body") else {
        return xml.to_string();
    };
    let Some(body_open_end) = xml[body_start..]
        .find('>')
        .map(|o| body_start + o + 1)
    else {
        return xml.to_string();
    };
    let Some(body_close) = xml.rfind("</w:body>") else {
        return xml.to_string();
    };

    let inner = &xml[body_open_end..body_close];
    let sect_suffix = inner
        .rfind("<w:sectPr")
        .map(|idx| &inner[idx..])
        .unwrap_or("");
    let paras_part = &inner[..inner.len() - sect_suffix.len()];

    let parts: Vec<&str> = paras_part.split("</w:p>").collect();
    let mut rebuilt: Vec<String> = Vec::new();
    let mut preamble_done = 0usize;
    let mut i = 0usize;

    while i < parts.len() {
        let chunk = parts[i];
        if chunk.trim().is_empty() {
            i += 1;
            continue;
        }

        let text = paragraph_text(chunk);
        let trimmed = text.trim();

        if let Some(key) = section_key_for_header(&text) {
            rebuilt.push(format!("{chunk}</w:p>"));
            i += 1;
            let style_source = parts
                .get(i)
                .map(|c| format!("{c}</w:p>"))
                .unwrap_or_else(|| format!("{chunk}</w:p>"));
            rebuilt.push(placeholder_paragraph(key, &style_source));

            i += 1;
            while i < parts.len() {
                let next_text = paragraph_text(parts[i]).trim().to_string();
                if section_key_for_header(&next_text).is_some() {
                    break;
                }
                i += 1;
            }
            continue;
        }

        if preamble_done < 2 && !trimmed.is_empty() {
            let key = if preamble_done == 0 { "name" } else { "contact" };
            rebuilt.push(placeholder_paragraph(key, &format!("{chunk}</w:p>")));
            preamble_done += 1;
            i += 1;
            continue;
        }

        if !trimmed.is_empty() {
            rebuilt.push(format!("{chunk}</w:p>"));
        }
        i += 1;
    }

    format!(
        "{}{}{}{}",
        &xml[..body_open_end],
        rebuilt.join(""),
        sect_suffix,
        &xml[body_close..]
    )
}
