use crate::db::Database;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub profile_id: String,
    pub job_description: Option<String>,
    pub job_title: Option<String>,
    pub company: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionInput {
    pub profile_id: String,
    pub job_description: Option<String>,
    pub job_title: Option<String>,
    pub company: Option<String>,
}

#[tauri::command]
pub fn list_sessions(
    db: State<'_, Database>,
    profile_id: Option<String>,
) -> Result<Vec<Session>, String> {
    db.with_conn(|conn| {
        let (sql, params): (String, Vec<String>) = match profile_id {
            Some(pid) => (
                "SELECT id, profile_id, job_description, job_title, company, created_at
                 FROM sessions WHERE profile_id = ?1 ORDER BY created_at DESC".into(),
                vec![pid],
            ),
            None => (
                "SELECT id, profile_id, job_description, job_title, company, created_at
                 FROM sessions ORDER BY created_at DESC".into(),
                vec![],
            ),
        };

        let mut stmt = conn.prepare(&sql)?;
        let rows = if params.is_empty() {
            stmt.query_map([], map_session)?
        } else {
            stmt.query_map(rusqlite::params![&params[0]], map_session)?
        };
        rows.collect()
    })
    .map_err(|e| e.to_string())
}

fn map_session(row: &rusqlite::Row) -> rusqlite::Result<Session> {
    Ok(Session {
        id: row.get(0)?,
        profile_id: row.get(1)?,
        job_description: row.get(2)?,
        job_title: row.get(3)?,
        company: row.get(4)?,
        created_at: row.get(5)?,
    })
}

#[tauri::command]
pub fn get_session(db: State<'_, Database>, id: String) -> Result<Session, String> {
    db.with_conn(|conn| {
        conn.query_row(
            "SELECT id, profile_id, job_description, job_title, company, created_at
             FROM sessions WHERE id = ?1",
            [&id],
            map_session,
        )
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_session(
    db: State<'_, Database>,
    input: CreateSessionInput,
) -> Result<Session, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    db.with_conn(|conn| {
        conn.execute(
            "INSERT INTO sessions (id, profile_id, job_description, job_title, company, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                &id,
                &input.profile_id,
                &input.job_description,
                &input.job_title,
                &input.company,
                &now
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_session(db, id)
}

#[tauri::command]
pub fn update_session(
    db: State<'_, Database>,
    id: String,
    job_description: Option<String>,
    job_title: Option<String>,
    company: Option<String>,
) -> Result<Session, String> {
    let existing = get_session(db.clone(), id.clone())?;

    db.with_conn(|conn| {
        conn.execute(
            "UPDATE sessions SET job_description = ?1, job_title = ?2, company = ?3 WHERE id = ?4",
            rusqlite::params![
                job_description.or(existing.job_description),
                job_title.or(existing.job_title),
                company.or(existing.company),
                &id
            ],
        )?;
        Ok(())
    })
    .map_err(|e| e.to_string())?;

    get_session(db, id)
}

#[tauri::command]
pub fn delete_session(db: State<'_, Database>, id: String) -> Result<(), String> {
    db.with_conn(|conn| {
        conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])?;
        Ok(())
    })
    .map_err(|e| e.to_string())
}
