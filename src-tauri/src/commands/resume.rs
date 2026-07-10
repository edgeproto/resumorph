use crate::commands::app_data::profile_dir;
use crate::commands::profiles::Profile;
use crate::db::Database;
use crate::docx;
use crate::pdf;
use crate::resume_parser::{parse_sections, ParsedResume};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestResult {
    pub profile: Profile,
    pub parsed: ParsedResume,
    pub stored_path: String,
}

fn extension_lower(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase())
}

fn copy_resume_file(
    app: &AppHandle,
    profile_id: &str,
    source: &Path,
) -> Result<(PathBuf, String), String> {
    let ext = extension_lower(source).ok_or("File has no extension")?;
    if ext != "docx" && ext != "pdf" {
        return Err("Only .docx and .pdf files are supported".into());
    }

    let dest_dir = profile_dir(app, profile_id)?;
    let dest = dest_dir.join(format!("original.{ext}"));

    std::fs::copy(source, &dest).map_err(|e| format!("Failed to copy resume file: {e}"))?;

    Ok((dest, ext))
}

fn extract_text(path: &Path, source_type: &str) -> Result<String, String> {
    match source_type {
        "docx" => docx::extract_text(path).map_err(|e| e.to_string()),
        "pdf" => pdf::extract_text(path).map_err(|e| e.to_string()),
        _ => Err(format!("Unsupported source type: {source_type}")),
    }
}

#[tauri::command]
pub async fn ingest_resume_file(
    app: AppHandle,
    db: State<'_, Database>,
    profile_id: String,
    file_path: String,
) -> Result<IngestResult, String> {
    let source = PathBuf::from(&file_path);
    if !source.exists() {
        return Err(format!("File not found: {file_path}"));
    }

    let (stored_path, source_type) = copy_resume_file(&app, &profile_id, &source)?;
    let text = extract_text(&stored_path, &source_type)?;
    let parsed = parse_sections(&text);
    let parsed_json = serde_json::to_string(&parsed).map_err(|e| e.to_string())?;
    let now = chrono::Utc::now().to_rfc3339();

    let template_path_str = if source_type == "docx" {
        let dest_dir = profile_dir(&app, &profile_id)?;
        let export_template = dest_dir.join("export-template.docx");
        crate::docx::prepare_export_template(&stored_path, &export_template)
            .map_err(|e| format!("Failed to prepare export template: {e}"))?;
        export_template.to_string_lossy().into_owned()
    } else {
        stored_path.to_string_lossy().into_owned()
    };

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE profiles SET source_type = ?1, template_path = ?2,
             parsed_json = ?3, updated_at = ?4 WHERE id = ?5",
            rusqlite::params![
                &source_type,
                &template_path_str,
                &parsed_json,
                &now,
                &profile_id
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    let profile = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT id, name, source_type, template_path, parsed_json, created_at, updated_at
                 FROM profiles WHERE id = ?1",
                [&profile_id],
                |row| {
                    Ok(Profile {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        source_type: row.get(2)?,
                        template_path: row.get(3)?,
                        parsed_json: row.get(4)?,
                        created_at: row.get(5)?,
                        updated_at: row.get(6)?,
                    })
                },
            )
        })
        .map_err(|e| e.to_string())?;

    Ok(IngestResult {
        profile,
        parsed,
        stored_path: template_path_str.clone(),
    })
}

#[tauri::command]
pub fn get_profile_resume_text(
    db: State<'_, Database>,
    profile_id: String,
) -> Result<ParsedResume, String> {
    let profile = db
        .with_conn(|conn| {
            conn.query_row(
                "SELECT source_type, template_path FROM profiles WHERE id = ?1",
                [&profile_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
        })
        .map_err(|e| e.to_string())?;

    let (source_type, template_path) = profile;
    let template_path = template_path.ok_or("Profile has no uploaded resume")?;
    let path = PathBuf::from(&template_path);
    let text = extract_text(&path, &source_type)?;
    Ok(parse_sections(&text))
}

#[tauri::command]
pub async fn pick_and_ingest_resume(
    app: AppHandle,
    db: State<'_, Database>,
    profile_id: String,
) -> Result<Option<IngestResult>, String> {
    use tauri_plugin_dialog::DialogExt;

    let file = app
        .dialog()
        .file()
        .add_filter("Resume", &["docx", "pdf"])
        .blocking_pick_file();

    match file {
        Some(f) => {
            let path = f
                .into_path()
                .map_err(|e| format!("Invalid file path: {e}"))?
                .to_string_lossy()
                .into_owned();
            let result = ingest_resume_file(app, db, profile_id, path).await?;
            Ok(Some(result))
        }
        None => Ok(None),
    }
}
