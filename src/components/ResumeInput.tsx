import { useEffect, useRef, useState } from "react";
import {
  parseResumeFile,
  parseResumeText,
  pickAndParseResume,
  resumeLabel,
} from "../lib/resume";
import { isTauri } from "../lib/tauri";
import type { ParsedResume } from "../lib/types";

interface ResumeInputProps {
  value: ParsedResume | null;
  onChange: (resume: ParsedResume | null) => void;
  compact?: boolean;
  label?: string;
}

export function ResumeInput({
  value,
  onChange,
  compact = false,
  label = "Resume",
}: ResumeInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [editing, setEditing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (value && !editing) {
      setDraftText(value.fullText);
    }
  }, [value, editing]);

  async function commitDraft(text: string) {
    if (!text.trim()) {
      onChange(null);
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseResumeText(text);
      onChange(parsed);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function handleFileUpload() {
    if (isTauri()) {
      setParsing(true);
      setError(null);
      try {
        const parsed = await pickAndParseResume();
        if (parsed) {
          onChange(parsed);
          setDraftText(parsed.fullText);
          setEditing(false);
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setParsing(false);
      }
      return;
    }
    fileRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseResumeFile(file);
      onChange(parsed);
      setDraftText(parsed.fullText);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  }

  function startEditing() {
    setDraftText(value?.fullText ?? "");
    setEditing(true);
    onChange(null);
  }

  if (value && compact && !editing) {
    return (
      <div className="jd-chip">
        <span className="jd-chip-label">{resumeLabel(value)}</span>
        <span className="jd-chip-meta muted">session resume</span>
        <button
          type="button"
          className="jd-chip-remove"
          onClick={() => {
            onChange(null);
            setDraftText("");
            setEditing(true);
          }}
          aria-label="Remove resume"
        >
          ×
        </button>
      </div>
    );
  }

  if (value && !editing) {
    return (
      <div className="jd-loaded">
        <div className="jd-loaded-header">
          <div>
            <strong>
              {label}: {resumeLabel(value)}
            </strong>
            <p className="muted small">{value.sections.length} sections parsed</p>
          </div>
          <button type="button" className="btn-ghost" onClick={startEditing}>
            Change
          </button>
        </div>
        <pre className="jd-preview">
          {value.fullText.slice(0, 400)}
          {value.fullText.length > 400 ? "..." : ""}
        </pre>
      </div>
    );
  }

  return (
    <div className="jd-upload">
      <div className="jd-upload-zone">
        <p className="jd-upload-title">Add {label.toLowerCase()}</p>
        <p className="muted">
          Paste text or upload a .txt, .docx, or .pdf file.
        </p>
        <div className="jd-upload-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={handleFileUpload}
            disabled={parsing}
          >
            {parsing ? "Reading..." : "Upload file"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.docx,.pdf"
            hidden
            onChange={handleFileChange}
          />
        </div>
      </div>
      <div className="jd-paste">
        <textarea
          rows={compact ? 4 : 6}
          placeholder="Or paste resume text here..."
          value={draftText}
          onChange={(e) => setDraftText(e.target.value)}
          onBlur={() => commitDraft(draftText)}
          disabled={parsing}
        />
        <p className="muted small">Keep typing — parsed when you click away.</p>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
