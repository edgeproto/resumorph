use crate::docx;
use crate::jd_parser::{parse_jd_text, ParsedJobDescription};
use std::path::Path;
use tauri::AppHandle;

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
}

fn extract_jd_file_text(path: &Path) -> Result<(String, String), String> {
    let ext = extension_lower(path).ok_or("File has no extension")?;
    let text = match ext.as_str() {
        "txt" | "md" => std::fs::read_to_string(path)
            .map_err(|e| format!("Failed to read text file: {e}"))?,
        "docx" => docx::extract_text(path).map_err(|e| e.to_string())?,
        "pdf" => crate::pdf::extract_text(path).map_err(|e| e.to_string())?,
        _ => return Err("Supported formats: .txt, .md, .docx, .pdf".into()),
    };
    Ok((text, ext))
}

#[tauri::command]
pub fn parse_jd_from_text(text: String) -> Result<ParsedJobDescription, String> {
    Ok(parse_jd_text(&text, "text"))
}

#[tauri::command]
pub fn parse_jd_from_file(file_path: String) -> Result<ParsedJobDescription, String> {
    let path = Path::new(&file_path);
    if !path.exists() {
        return Err(format!("File not found: {file_path}"));
    }
    let (text, ext) = extract_jd_file_text(path)?;
    Ok(parse_jd_text(&text, &ext))
}

#[tauri::command]
pub async fn pick_and_parse_jd(app: AppHandle) -> Result<Option<ParsedJobDescription>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Job description", &["txt", "md", "docx", "pdf"])
        .blocking_pick_file();

    match file {
        Some(f) => {
            let path = f
                .into_path()
                .map_err(|e| format!("Invalid file path: {e}"))?
                .to_string_lossy()
                .into_owned();
            let parsed = parse_jd_from_file(path)?;
            Ok(Some(parsed))
        }
        None => Ok(None),
    }
}
