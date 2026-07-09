use crate::docx;
use crate::pdf;
use crate::resume_parser::{parse_sections, ParsedResume};
use std::path::Path;
use tauri::AppHandle;

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
}

fn extract_resume_text(path: &Path) -> Result<(String, String), String> {
    let ext = extension_lower(path).ok_or("File has no extension")?;
    let text = match ext.as_str() {
        "txt" | "md" => std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read text file: {e}"))?,
        "docx" => docx::extract_text(path).map_err(|e| e.to_string())?,
        "pdf" => pdf::extract_text(path).map_err(|e| e.to_string())?,
        _ => return Err("Supported formats: .txt, .md, .docx, .pdf".into()),
    };
    Ok((text, ext))
}

#[tauri::command]
pub fn parse_resume_from_text(text: String) -> Result<ParsedResume, String> {
    Ok(parse_sections(&text))
}

#[tauri::command]
pub fn parse_resume_from_file(file_path: String) -> Result<ParsedResume, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let (text, _) = extract_resume_text(path)?;
    Ok(parse_sections(&text))
}

#[tauri::command]
pub async fn pick_and_parse_resume(app: AppHandle) -> Result<Option<ParsedResume>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Resume", &["txt", "md", "docx", "pdf"])
        .blocking_pick_file();

    match file {
        Some(f) => {
            let path = f
                .into_path()
                .map_err(|e| format!("Invalid file path: {e}"))?
                .to_string_lossy()
                .into_owned();
            let parsed = parse_resume_from_file(path)?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}
