use rusqlite::{Connection, Result as SqlResult};
use std::path::Path;
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new(db_path: &Path) -> SqlResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                rusqlite::Error::InvalidPath(format!("Failed to create db directory: {e}").into())
            })?;
        }

        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> SqlResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                source_type TEXT NOT NULL,
                template_path TEXT,
                parsed_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS prompt_presets (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                system_prompt TEXT NOT NULL,
                user_prompt TEXT NOT NULL,
                mode TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                profile_id TEXT NOT NULL,
                job_description TEXT,
                job_title TEXT,
                company TEXT,
                resume_json TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS outputs (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content_json TEXT,
                cover_letter TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            ",
        )?;

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM prompt_presets",
            [],
            |row| row.get(0),
        )?;

        if count == 0 {
            conn.execute(
                "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    "Default Tailor",
                    DEFAULT_TAILOR_SYSTEM,
                    DEFAULT_TAILOR_USER,
                    "tailor"
                ],
            )?;
            conn.execute(
                "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
                 VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                rusqlite::params![
                    uuid::Uuid::new_v4().to_string(),
                    "Default Q&A",
                    DEFAULT_QA_SYSTEM,
                    DEFAULT_QA_USER,
                    "qa"
                ],
            )?;
        } else {
            let qa_count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM prompt_presets WHERE mode = 'qa'",
                [],
                |row| row.get(0),
            )?;
            if qa_count == 0 {
                conn.execute(
                    "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
                     VALUES (?1, ?2, ?3, ?4, ?5, 1)",
                    rusqlite::params![
                        uuid::Uuid::new_v4().to_string(),
                        "Default Q&A",
                        DEFAULT_QA_SYSTEM,
                        DEFAULT_QA_USER,
                        "qa"
                    ],
                )?;
            }
        }

        seed_default_settings(&conn)?;
        migrate_sessions_resume_json(&conn)?;

        Ok(())
    }

    pub fn with_conn<F, T>(&self, f: F) -> SqlResult<T>
    where
        F: FnOnce(&Connection) -> SqlResult<T>,
    {
        let conn = self.conn.lock().unwrap();
        f(&conn)
    }
}

const DEFAULT_TAILOR_SYSTEM: &str = "You are an expert resume writer. Never fabricate experience or skills. \
Optimize keywords from the job description while staying truthful. \
Output strict JSON matching the requested schema.";

const DEFAULT_TAILOR_USER: &str = "Tailor this resume for the job description.\n\n\
Profile: {{profile_name}}\n\
Role: {{job_title}} at {{company}}\n\n\
Resume:\n{{resume_text}}\n\n\
Structured sections:\n{{resume_json}}\n\n\
Job description:\n{{job_description}}\n\n\
Template placeholders (if any): {{placeholder_keys}}\n\n\
Return JSON with keys: name, contact, summary, experience (array of {title, company, bullets}), skills, education, cover_letter (optional).";

const DEFAULT_QA_SYSTEM: &str = "You help with job application questions. Be concise, professional, and truthful. \
Never fabricate experience or skills. Use the candidate's actual resume and job context.";

const DEFAULT_QA_USER: &str = "Profile: {{profile_name}}\n\
Role: {{job_title}} at {{company}}\n\n\
Resume:\n{{resume_text}}\n\n\
Structured sections:\n{{resume_json}}\n\n\
Job description:\n{{job_description}}\n\n\
Question: {{user_question}}";

const DEFAULT_SESSION_SYSTEM: &str = "You are an expert career assistant for job applications. \
You help tailor resumes, write cover letters, answer application questions, and identify gaps. \
Never fabricate experience or skills. Use the resume and job description provided in context. \
Reference earlier messages in this conversation when relevant. \
When asked to tailor a resume, respond with valid JSON only (keys: name, contact, summary, experience as array of {title, company, bullets}, skills, education, cover_letter optional). \
Otherwise respond in clear, professional prose.";

const DEFAULT_SESSION_USER: &str = "{{user_question}}";

fn migrate_sessions_resume_json(conn: &Connection) -> SqlResult<()> {
    let mut stmt = conn.prepare("PRAGMA table_info(sessions)")?;
    let cols: Vec<String> = stmt
        .query_map([], |row| row.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    if !cols.iter().any(|c| c == "resume_json") {
        conn.execute("ALTER TABLE sessions ADD COLUMN resume_json TEXT", [])?;
    }

    let session_count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM prompt_presets WHERE mode = 'session'",
        [],
        |row| row.get(0),
    )?;
    if session_count == 0 {
        conn.execute(
            "INSERT INTO prompt_presets (id, name, system_prompt, user_prompt, mode, is_default)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)",
            rusqlite::params![
                uuid::Uuid::new_v4().to_string(),
                "Default Session",
                DEFAULT_SESSION_SYSTEM,
                DEFAULT_SESSION_USER,
                "session"
            ],
        )?;
    }
    Ok(())
}

fn seed_default_settings(conn: &Connection) -> SqlResult<()> {
    let defaults = [
        ("default_provider", "anthropic"),
        ("default_model_anthropic", "claude-sonnet-4-20250514"),
        ("default_model_openai", "gpt-4o"),
        ("default_model_custom", "gpt-4o"),
        ("custom_base_url", "http://localhost:11434/v1/chat/completions"),
        ("temperature", "0.7"),
        ("export_include_pdf", "false"),
        ("pdf_converter", "auto"),
    ];

    for (key, value) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )?;
    }
    Ok(())
}
