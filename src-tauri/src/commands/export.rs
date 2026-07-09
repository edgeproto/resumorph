use crate::commands::app_data::profile_dir;
use crate::db::Database;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub id: String,
    pub session_id: String,
    pub content_json: Option<String>,
    pub cover_letter: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateOutputInput {
    pub session_id: String,
    pub content_json: Option<String>,
    pub cover_letter: Option<String>,
}

fn map_output(row: &rusqlite::Row) -> rusqlite::Result<Output> {
    Ok(Output {
        id: row.get(0)?,
        session_id: row.get(1)?,
        content_json: row.get(2)?,
        cover_letter: row.get(3)?,
        created_at: row.get(4)?,
    })
}

#[tauri::command]
pub fn create_output(
    db: State<'_, Database>,
    input: CreateOutputInput,
) -> Result<Output, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO outputs (id, session_id, content_json, cover_letter, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                &id,
                &input.session_id,
                &input.content_json,
                &input.cover_letter,
                &now
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_output(db, id)
}

#[tauri::command]
pub fn get_output(db: State<'_, Database>, id: String) -> Result<Output, String> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT id, session_id, content_json, cover_letter, created_at
             FROM outputs WHERE id = ?1",
            [&id],
            map_output,
        )
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_outputs(
    db: State<'_, Database>,
    session_id: String,
) -> Result<Vec<Output>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, session_id, content_json, cover_letter, created_at
             FROM outputs WHERE session_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([&session_id], map_output)?;
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read file {path}: {e}"))
}

#[tauri::command]
pub async fn save_export_file(
    app: AppHandle,
    data: Vec<u8>,
    default_name: String,
    file_type: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    let (filter_name, extensions): (&str, Vec<&str>) = match file_type.as_str() {
        "pdf" => ("PDF", vec!["pdf"]),
        _ => ("Word Document", vec!["docx"]),
    };

    let dest = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(filter_name, &extensions)
        .blocking_save_file();

    match dest {
        Some(f) => {
            let path = f
                .into_path()
                .map_err(|e| format!("Invalid save path: {e}"))?;
            std::fs::write(&path, &data)
                .map_err(|e| format!("Failed to write file: {e}"))?;
            Ok(Some(path.to_string_lossy().into_owned()))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub fn detect_docx_placeholders(path: String) -> Result<Vec<String>, String> {
    crate::docx::detect_placeholders(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_builtin_template_path(app: AppHandle, template_id: String) -> Result<String, String> {
    let filename = match template_id.as_str() {
        "modern" => "modern.docx",
        "classic" => "classic.docx",
        "ats-friendly" => "ats-friendly.docx",
        _ => return Err(format!("Unknown template: {template_id}")),
    };

    resolve_builtin_template(&app, filename)
}

fn resolve_builtin_template(app: &AppHandle, filename: &str) -> Result<String, String> {
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled = resource_dir.join("templates").join(filename);
        if bundled.exists() {
            return Ok(bundled.to_string_lossy().into_owned());
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let dev_path = manifest_dir.join("..").join("templates").join(filename);
    if dev_path.exists() {
        return Ok(dev_path.canonicalize().map_err(|e| e.to_string())?.to_string_lossy().into_owned());
    }

    Err(format!("Built-in template not found: {filename}"))
}

#[tauri::command]
pub fn list_builtin_templates(_app: AppHandle) -> Result<Vec<String>, String> {
    Ok(vec![
        "modern".into(),
        "classic".into(),
        "ats-friendly".into(),
    ])
}

#[tauri::command]
pub fn inject_docx_placeholders(
    app: AppHandle,
    db: State<'_, Database>,
    profile_id: String,
    placeholders: Vec<String>,
) -> Result<String, String> {
    let template_path: String = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT template_path FROM profiles WHERE id = ?1",
                [&profile_id],
                |row| row.get(0),
            )
        })
        .map_err(|e| e.to_string())?;

    let source = PathBuf::from(&template_path);
    if !source.exists() {
        return Err("Profile template file not found".into());
    }

    let dest_dir = profile_dir(&app, &profile_id)?;
    let dest = dest_dir.join("template-tagged.docx");

    crate::docx::inject_placeholders(&source, &dest, &placeholders)
        .map_err(|e| e.to_string())?;

    let dest_str = dest.to_string_lossy().into_owned();
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE profiles SET template_path = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![&dest_str, &now, &profile_id],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[tauri::command]
pub fn convert_docx_to_pdf(
    docx_path: String,
    converter: Option<String>,
) -> Result<String, String> {
    let docx = PathBuf::from(&docx_path);
    if !docx.exists() {
        return Err(format!("DOCX file not found: {docx_path}"));
    }

    let pdf_path = docx.with_extension("pdf");
    let mode = converter.as_deref().unwrap_or("auto");

    match mode {
        "word" => crate::pdf::convert_via_word_only(&docx, &pdf_path)
            .map_err(|e| e.to_string())?,
        "libreoffice" => crate::pdf::convert_via_libreoffice_only(&docx, &pdf_path)
            .map_err(|e| e.to_string())?,
        _ => crate::pdf::convert_docx_to_pdf(&docx, &pdf_path).map_err(|e| e.to_string())?,
    }

    Ok(pdf_path.to_string_lossy().into_owned())
}
