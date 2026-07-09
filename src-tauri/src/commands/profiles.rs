use crate::db::Database;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub source_type: String,
    pub template_path: Option<String>,
    pub parsed_json: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProfileInput {
    pub name: String,
}

#[tauri::command]
pub fn list_profiles(db: State<'_, Database>) -> Result<Vec<Profile>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, source_type, template_path, parsed_json, created_at, updated_at
             FROM profiles ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Profile {
                id: row.get(0)?,
                name: row.get(1)?,
                source_type: row.get(2)?,
                template_path: row.get(3)?,
                parsed_json: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })?;
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_profile(db: State<'_, Database>, id: String) -> Result<Profile, String> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT id, name, source_type, template_path, parsed_json, created_at, updated_at
             FROM profiles WHERE id = ?1",
            [&id],
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
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_profile(
    db: State<'_, Database>,
    input: CreateProfileInput,
) -> Result<Profile, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO profiles (id, name, source_type, template_path, parsed_json, created_at, updated_at)
             VALUES (?1, ?2, 'pending', NULL, NULL, ?3, ?3)",
            rusqlite::params![&id, &input.name, &now],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_profile(db, id)
}

#[tauri::command]
pub fn update_profile(
    db: State<'_, Database>,
    id: String,
    name: Option<String>,
    source_type: Option<String>,
    template_path: Option<String>,
    parsed_json: Option<String>,
) -> Result<Profile, String> {
    let now = Utc::now().to_rfc3339();
    let existing = get_profile(db.clone(), id.clone())?;

    let name = name.unwrap_or(existing.name);
    let source_type = source_type.unwrap_or(existing.source_type);
    let template_path = template_path.or(existing.template_path);
    let parsed_json = parsed_json.or(existing.parsed_json);

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE profiles SET name = ?1, source_type = ?2, template_path = ?3,
             parsed_json = ?4, updated_at = ?5 WHERE id = ?6",
            rusqlite::params![
                &name,
                &source_type,
                &template_path,
                &parsed_json,
                &now,
                &id
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_profile(db, id)
}

#[tauri::command]
pub fn delete_profile(
    app: AppHandle,
    db: State<'_, Database>,
    id: String,
) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM profiles WHERE id = ?1", [&id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    if let Ok(data_dir) = app.path().app_data_dir() {
        let profile_dir = data_dir.join("profiles").join(&id);
        let _ = std::fs::remove_dir_all(profile_dir);
    }

    Ok(())
}
