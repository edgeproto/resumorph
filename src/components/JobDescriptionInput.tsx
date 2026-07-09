import { useRef, useState } from "react";
import { jdLabel, parseJdFile, parseJdText, pickAndParseJd } from "../lib/jd";
import { isTauri } from "../lib/tauri";
import type { ParsedJobDescription } from "../lib/types";

interface JobDescriptionInputProps {
  value: ParsedJobDescription | null;
  onChange: (jd: ParsedJobDescription | null) => void;
  compact?: boolean;
}

export function JobDescriptionInput({
  value,
  onChange,
  compact = false,
}: JobDescriptionInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsing, setParsing] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handlePaste(text: string) {
    setPasteText(text);
    if (!text.trim()) {
      onChange(null);
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const parsed = await parseJdText(text);
      onChange(parsed);
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
        const parsed = await pickAndParseJd();
        if (parsed) {
          onChange(parsed);
          setPasteText(parsed.text.slice(0, 500) + (parsed.text.length > 500 ? "..." : ""));
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
      const parsed = await parseJdFile(file);
      onChange(parsed);
      setPasteText(parsed.text.slice(0, 500) + (parsed.text.length > 500 ? "..." : ""));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setParsing(false);
      e.target.value = "";
    }
  }

  if (value && compact) {
    return (
      <div className="jd-chip">
        <span className="jd-chip-label">{jdLabel(value)}</span>
        <span className="jd-chip-meta muted">
          {value.sourceType.toUpperCase()} · auto-detected
        </span>
        <button
          type="button"
          className="jd-chip-remove"
          onClick={() => {
            onChange(null);
            setPasteText("");
          }}
          aria-label="Remove job description"
        >
          ×
        </button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="jd-loaded">
        <div className="jd-loaded-header">
          <div>
            <strong>{jdLabel(value)}</strong>
            <p className="muted small">
              Role and company detected automatically from your upload
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              onChange(null);
              setPasteText("");
            }}
          >
            Change
          </button>
        </div>
        <pre className="jd-preview">{value.text.slice(0, 600)}{value.text.length > 600 ? "..." : ""}</pre>
      </div>
    );
  }

  return (
    <div className="jd-upload">
      <div className="jd-upload-zone">
        <p className="jd-upload-title">Add a job description</p>
        <p className="muted">
          Paste text or upload a .txt, .docx, or .pdf file — we&apos;ll detect the role and company.
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
          placeholder="Or paste the full job description here..."
          value={pasteText}
          onChange={(e) => handlePaste(e.target.value)}
          disabled={parsing}
        />
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
