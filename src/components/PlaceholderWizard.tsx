import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, parseProfileResume } from "../lib/api";
import { DEFAULT_PLACEHOLDER_KEYS } from "../lib/prompts";

interface PlaceholderWizardProps {
  profileId: string;
  onClose: () => void;
}

export function PlaceholderWizard({ profileId, onClose }: PlaceholderWizardProps) {
  const queryClient = useQueryClient();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    new Set(DEFAULT_PLACEHOLDER_KEYS),
  );
  const [error, setError] = useState<string | null>(null);

  const { data: profile } = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => api.getProfile(profileId),
  });

  const parsed = profile ? parseProfileResume(profile) : null;

  const { data: existingPlaceholders = [] } = useQuery({
    queryKey: ["placeholders", profile?.templatePath],
    queryFn: () =>
      profile?.templatePath
        ? api.detectDocxPlaceholders(profile.templatePath)
        : [],
    enabled: !!profile?.templatePath && profile.sourceType === "docx",
  });

  const injectMutation = useMutation({
    mutationFn: () =>
      api.injectDocxPlaceholders(profileId, Array.from(selectedKeys)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile", profileId] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      onClose();
    },
    onError: (e) => setError((e as Error).message),
  });

  if (!profile) return null;

  if (profile.sourceType !== "docx" || !profile.templatePath) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <header className="modal-header">
            <h3>Placeholder wizard</h3>
            <button type="button" className="icon-btn" onClick={onClose}>
              ×
            </button>
          </header>
          <div className="modal-body">
            <p className="error">
              Placeholder wizard requires a DOCX resume. PDF uploads use built-in
              templates at export time.
            </p>
          </div>
          <footer className="modal-footer">
            <button type="button" onClick={onClose}>
              Close
            </button>
          </footer>
        </div>
      </div>
    );
  }

  const suggestedFromSections = (parsed?.sections ?? []).map((s) =>
    s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  );

  const allKeys = [
    ...new Set([...DEFAULT_PLACEHOLDER_KEYS, ...suggestedFromSections]),
  ];

  function toggleKey(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Placeholder wizard</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body">
          <p>
            Add <code>{"{placeholder}"}</code> tags to a <strong>copy</strong> of
            your resume template. Your original file is never modified.
          </p>

          {existingPlaceholders.length > 0 && (
            <div className="info-box">
              <strong>Existing placeholders detected:</strong>{" "}
              {existingPlaceholders.map((p) => `{${p}}`).join(", ")}
            </div>
          )}

          <h4>Suggested placeholders</h4>
          <p className="muted small">
            Based on your resume sections. Select which to inject into a tagged
            template copy.
          </p>
          <div className="placeholder-grid">
            {allKeys.map((key) => (
              <label key={key} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selectedKeys.has(key)}
                  onChange={() => toggleKey(key)}
                />
                <code>{`{${key}}`}</code>
              </label>
            ))}
          </div>

          {parsed && (
            <div className="sections-preview">
              <h4>Detected sections</h4>
              {parsed.sections.map((s) => (
                <details key={s.name}>
                  <summary>{s.name}</summary>
                  <pre>{s.content.slice(0, 300)}...</pre>
                </details>
              ))}
            </div>
          )}

          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={selectedKeys.size === 0 || injectMutation.isPending}
            onClick={() => injectMutation.mutate()}
          >
            {injectMutation.isPending
              ? "Creating..."
              : "Create tagged template copy"}
          </button>
        </footer>
      </div>
    </div>
  );
}
