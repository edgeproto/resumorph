use crate::db::Database;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptPreset {
    pub id: String,
    pub name: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub mode: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePromptPresetInput {
    pub name: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub mode: String,
    pub is_default: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePromptPresetInput {
    pub id: String,
    pub name: Option<String>,
    pub system_prompt: Option<String>,
    pub user_prompt: Option<String>,
    pub mode: Option<String>,
    pub is_default: Option<bool>,
}

fn map_preset(row: &rusqlite::Row) -> rusqlite::Result<PromptPreset> {
    Ok(PromptPreset {
        id: row.get(0)?,
        name: row.get(1)?,
        system_prompt: row.get(2)?,
        user_prompt: row.get(3)?,
        mode: row.get(4)?,
        is_default: row.get::<_, i64>(5)? != 0,
    })
}

#[tauri::command]
pub fn list_prompt_presets(db: State<'_, Database>) -> Result<Vec<PromptPreset>, String> {
    db.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, name, system_prompt, user_prompt, mode, is_default
             FROM prompt_presets ORDER BY is_default DESC, name ASC",
        )?;
        let rows = stmt.query_map([], map_preset)?;
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_prompt_preset(db: State<'_, Database>, id: String) -> Result<PromptPreset, String> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT id, name, system_prompt, user_prompt, mode, is_default
             FROM prompt_presets WHERE id = ?1",
            [&id],
            map_preset,
        )
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_prompt_preset(
    db: State<'_, Database>,
    input: CreatePromptPresetInput,
) -> Result<PromptPreset, String> {
    let id = Uuid::new_v4().to_string();
    let is_default = input.is_default.unwrap_or(false);

    db.with_conn(|conn| {
        if is_default {
            conn.execute(
                "UPDATE prompt_presets SET is_default = 0 WHERE mode = ?1",
                [&input.mode],
            )?;
        }
        conn.execute(
            "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &id,
                &input.name,
                &input.system_prompt,
                &input.user_prompt,
                &input.mode,
                if is_default { 1 } else { 0 }
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_prompt_preset(db, id)
}

#[tauri::command]
pub fn update_prompt_preset(
    db: State<'_, Database>,
    input: UpdatePromptPresetInput,
) -> Result<PromptPreset, String> {
    let existing = get_prompt_preset(db.clone(), input.id.clone())?;
    let name = input.name.unwrap_or(existing.name);
    let system_prompt = input.system_prompt.unwrap_or(existing.system_prompt);
    let user_prompt = input.user_prompt.unwrap_or(existing.user_prompt);
    let mode = input.mode.unwrap_or(existing.mode);
    let is_default = input.is_default.unwrap_or(existing.is_default);

    db.with_conn(|conn| {
        if is_default {
            conn.execute(
                "UPDATE prompt_presets SET is_default = 0 WHERE mode = ?1",
                [&mode],
            )?;
        }
        conn.execute(
            "UPDATE prompt_presets SET name = ?1, system_prompt = ?2, user_prompt = ?3,
             mode = ?4, is_default = ?5 WHERE id = ?6",
            rusqlite::params![
                &name,
                &system_prompt,
                &user_prompt,
                &mode,
                if is_default { 1 } else { 0 },
                &input.id
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_prompt_preset(db, input.id)
}

#[tauri::command]
pub fn delete_prompt_preset(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM prompt_presets WHERE id = ?1", [&id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}
