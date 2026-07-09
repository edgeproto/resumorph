import { useCallback, useRef } from "react";
import { PROMPT_VARIABLES } from "../lib/prompts";

interface PromptEditorProps {
  systemPrompt: string;
  userPrompt: string;
  onSystemChange: (value: string) => void;
  onUserChange: (value: string) => void;
  mode: "tailor" | "cover_letter" | "qa";
  readOnly?: boolean;
}

export function PromptEditor({
  systemPrompt,
  userPrompt,
  onSystemChange,
  onUserChange,
  mode,
  readOnly = false,
}: PromptEditorProps) {
  const userRef = useRef<HTMLTextAreaElement>(null);

  const insertVariable = useCallback(
    (key: string, target: "system" | "user") => {
      const token = `{{${key}}}`;
      if (target === "system") {
        onSystemChange(systemPrompt + token);
        return;
      }
      const el = userRef.current;
      if (!el) {
        onUserChange(userPrompt + token);
        return;
      }
      const start = el.selectionStart ?? userPrompt.length;
      const end = el.selectionEnd ?? start;
      const next = userPrompt.slice(0, start) + token + userPrompt.slice(end);
      onUserChange(next);
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
    },
    [onSystemChange, onUserChange, systemPrompt, userPrompt],
  );

  const relevantVars = PROMPT_VARIABLES.filter((v) => {
    if (mode === "qa") {
      return [
        "resume_text",
        "resume_json",
        "job_description",
        "profile_name",
        "user_question",
        "job_title",
        "company",
      ].includes(v.key);
    }
    if (mode === "tailor") return v.key !== "user_question";
    return v.key !== "user_question";
  });

  return (
    <div className="prompt-editor">
      <div className="prompt-section">
        <label>
          System prompt
          <textarea
            rows={4}
            value={systemPrompt}
            onChange={(e) => onSystemChange(e.target.value)}
            readOnly={readOnly}
            placeholder="Instructions for the AI..."
          />
        </label>
        {!readOnly && (
          <div className="variable-chips">
            {relevantVars.map((v) => (
              <button
                key={`sys-${v.key}`}
                type="button"
                className="chip"
                title={v.description}
                onClick={() => insertVariable(v.key, "system")}
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="prompt-section">
        <label>
          User prompt template
          <textarea
            ref={userRef}
            rows={8}
            value={userPrompt}
            onChange={(e) => onUserChange(e.target.value)}
            readOnly={readOnly}
            placeholder="Template with {{variables}}..."
          />
        </label>
        {!readOnly && (
          <div className="variable-chips">
            {relevantVars.map((v) => (
              <button
                key={`user-${v.key}`}
                type="button"
                className="chip"
                title={v.description}
                onClick={() => insertVariable(v.key, "user")}
              >
                {`{{${v.key}}}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
