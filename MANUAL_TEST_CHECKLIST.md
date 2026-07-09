# Resumorph — Manual Test Checklist

Use this checklist to verify end-to-end functionality after setup or before release.

## Prerequisites

- [ ] `npm install` completed
- [ ] At least one LLM API key configured in Settings (Anthropic or OpenAI)
- [ ] A sample `.docx` resume file available for testing
- [ ] (Optional) Microsoft Word or LibreOffice installed for PDF export

---

## 1. Profile setup

- [ ] Launch app: `npm run tauri dev`
- [ ] Create a new profile (e.g. "Test Engineer — 2026")
- [ ] Upload a `.docx` resume via **Upload resume**
- [ ] Expand profile **Details** — parsed sections appear
- [ ] Re-upload works without errors

## 2. Placeholder wizard (Mode A)

- [ ] Click **Placeholder wizard** on a DOCX profile
- [ ] Existing/suggested placeholders are shown
- [ ] Select placeholders and click **Create tagged template copy**
- [ ] Profile template path updates to `template-tagged.docx`
- [ ] Original file is not modified (check file timestamps)

## 3. Settings

- [ ] Settings page shows data directory paths
- [ ] Save an API key — badge shows "Configured"
- [ ] Remove API key — badge shows "Not set"
- [ ] Change default provider and model — save preferences
- [ ] Reload app — settings persist
- [ ] Edit a prompt preset in Settings — variable chips insert `{{tokens}}`
- [ ] Save preset — changes appear in Tailor/Q&A preset dropdowns

## 4. Prompt editor

- [ ] Open Tailor → **Edit prompts**
- [ ] System and user prompt textareas are editable
- [ ] Click variable chips — tokens insert into prompt
- [ ] **Save preset** persists changes
- [ ] Default Tailor preset loads on first visit

## 5. Tailor flow

- [ ] Select profile with uploaded resume
- [ ] Enter job title, company, and job description
- [ ] Select provider and model
- [ ] Click **Tailor resume** — completes within ~60s
- [ ] Side-by-side preview shows original (left) and tailored (right)
- [ ] Output is valid JSON (summary, experience, skills, education)
- [ ] Session appears in **Previous session** dropdown on revisit
- [ ] No fabricated experience in preview (manual review)

## 6. DOCX export

- [ ] After tailoring, click **Export**
- [ ] **Original template (Mode A)** — exports merged DOCX if DOCX profile
- [ ] **Built-in template (Mode C)** — Modern, Classic, ATS-friendly all work
- [ ] Open exported file in Word — formatting intact, placeholders filled
- [ ] Cover letter checkbox exports separate file (if cover_letter in JSON)

## 7. PDF export

- [ ] Enable **Also export as PDF** in export dialog
- [ ] Export completes (Word COM on Windows, or LibreOffice fallback)
- [ ] PDF opens and matches DOCX content
- [ ] Settings → PDF converter preference is respected

## 8. Q&A chat

- [ ] Open Q&A Chat, select profile
- [ ] Enter job description context
- [ ] Click **Start chat session** or send a message
- [ ] Ask: "Write a short cover letter" — response uses resume context
- [ ] Ask: "What gaps should I address?" — response is relevant
- [ ] Messages persist after navigating away and back
- [ ] **Session history** dropdown loads prior sessions with messages
- [ ] Edit Q&A prompts — `{{user_question}}` variable works

## 9. Error handling

- [ ] Tailor without API key — clear error message
- [ ] Tailor without uploaded resume — button disabled + message
- [ ] PDF export without Word/LibreOffice — helpful error
- [ ] PDF-only profile — Mode A export disabled, Mode C works

## 10. Data privacy

- [ ] API keys not visible in `resumorph.db` (use keychain only)
- [ ] All files under `%APPDATA%/com.resumorph.app/`
- [ ] No network calls except to configured LLM provider

---

## Sign-off

| Tester | Date | Version | Pass/Fail |
|--------|------|---------|-----------|
|        |      | 0.1.0   |           |
