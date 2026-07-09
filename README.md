# Resumorph

Local-first Windows desktop app for tailoring resumes to job descriptions.

## Stack

- **Tauri 2** — native desktop shell (Rust)
- **React + TypeScript + Vite** — UI
- **SQLite** — profiles, sessions, messages, prompt presets, outputs
- **OS keychain** — API key storage (Anthropic, OpenAI, custom)
- **docxtemplater** — DOCX template merge (Mode A & C)
- **Word COM / LibreOffice** — PDF export on Windows

## Features

### Profiles
- Create profiles for each resume persona
- Upload `.docx` or `.pdf` once, reuse across applications
- **Placeholder wizard** — inject `{placeholder}` tags into a copy of your DOCX template

### Tailor workspace
- Job description, title, and company input
- Editable prompt presets with **variable chips** (`{{resume_text}}`, `{{job_description}}`, etc.)
- JSON-structured LLM output with **side-by-side preview** (original vs tailored)
- Session history per profile
- Export to DOCX (original template or built-in) and PDF

### Application Q&A
- Chat tied to profile + job session
- Persisted message history in SQLite
- Editable Q&A prompt presets

### Export
- **Mode A** — merge into your original DOCX template via docxtemplater
- **Mode C** — 3 built-in templates (Modern, Classic, ATS-friendly)
- **PDF** — Word COM automation (primary on Windows), LibreOffice headless fallback

### Settings
- API keys (OS keychain)
- Default LLM provider, models, temperature
- Custom OpenAI-compatible endpoint URL
- Export preferences (PDF default, converter choice)
- Full prompt preset editor

## Development

```bash
npm install
npm run tauri dev
```

Generate built-in DOCX templates (if missing):

```bash
node scripts/generate-templates.mjs
```

## Data locations

On Windows: `%APPDATA%/com.resumorph.app/`

| Path | Contents |
|------|----------|
| `resumorph.db` | SQLite database |
| `profiles/{id}/original.docx` | Uploaded resume files |
| `profiles/{id}/template-tagged.docx` | Placeholder-injected template copy |

## LLM providers

| Provider | API key setting | Default model |
|----------|----------------|---------------|
| Anthropic | Settings → Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | Settings → OpenAI | `gpt-4o` |
| Custom | Settings → Custom | Configurable base URL (Ollama, Groq, etc.) |

## Build

```bash
npm run tauri build
```

## Manual testing

See [MANUAL_TEST_CHECKLIST.md](MANUAL_TEST_CHECKLIST.md) for end-to-end verification steps.

## Architecture notes

- No server backend — all data stays local
- LLM calls go directly from the app to provider APIs
- DOCX merge runs in the frontend (docxtemplater); file I/O and PDF conversion run in Rust
- PDF export tries Microsoft Word COM first on Windows, then falls back to LibreOffice
