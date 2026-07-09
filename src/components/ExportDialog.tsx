import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { isTauri } from "../lib/tauri";
import {
  mergeDocxTemplate,
  tailoredToTemplateData,
  type TailoredResume,
} from "../lib/docx";
import { useAppSettings } from "../lib/settings";

export type ExportMode = "template" | "builtin";
export type BuiltinTemplateId = "modern" | "classic" | "ats-friendly";
export type ExportKind = "resume" | "cover_letter";

interface ExportDialogProps {
  profileId: string;
  tailored?: TailoredResume;
  coverLetter?: string;
  exportKind?: ExportKind;
  sessionId?: string;
  onClose: () => void;
}

export function ExportDialog({
  profileId,
  tailored,
  coverLetter,
  exportKind = "resume",
  sessionId,
  onClose,
}: ExportDialogProps) {
  const isCoverLetter = exportKind === "cover_letter";
  const letterText = coverLetter ?? tailored?.cover_letter ?? "";

  const [exportMode, setExportMode] = useState<ExportMode>("builtin");
  const [builtinTemplate, setBuiltinTemplate] =
    useState<BuiltinTemplateId>("modern");
  const [alsoExportPdf, setAlsoExportPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: settings } = useAppSettings();

  const { data: profile } = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => api.getProfile(profileId),
  });

  const { data: placeholders = [] } = useQuery({
    queryKey: ["placeholders", profile?.templatePath],
    queryFn: () =>
      profile?.templatePath
        ? api.detectDocxPlaceholders(profile.templatePath)
        : [],
    enabled:
      !isCoverLetter &&
      !!profile?.templatePath &&
      profile.sourceType === "docx",
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (isCoverLetter) {
        if (!letterText) throw new Error("No cover letter to export");
        const baseName = `cover-letter-${Date.now()}`;

        if (!isTauri()) {
          const blob = new Blob([letterText], { type: "text/plain" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${baseName}.txt`;
          a.click();
          URL.revokeObjectURL(url);
          return { docxPath: `${baseName}.txt` };
        }

        const templatePath = await api.getBuiltinTemplatePath("modern");
        const templateBytes = new Uint8Array(
          await api.readFileBytes(templatePath),
        );
        const merged = mergeDocxTemplate(templateBytes, {
          name: profile?.name ?? "",
          contact: "",
          summary: letterText,
          experience: "",
          skills: "",
          education: "",
          cover_letter: letterText,
        });
        const docxPath = await api.saveExportFile(
          Array.from(merged),
          `${baseName}.docx`,
          "docx",
        );
        if (!docxPath) return null;

        if (alsoExportPdf) {
          const pdfPath = await api.convertDocxToPdf(
            docxPath,
            settings?.pdfConverter,
          );
          return { docxPath, pdfPath };
        }
        return { docxPath, pdfPath: null };
      }

      if (!tailored) throw new Error("No tailored resume to export");

      const data = tailoredToTemplateData(tailored);
      let templatePath: string;

      if (exportMode === "builtin") {
        templatePath = await api.getBuiltinTemplatePath(builtinTemplate);
      } else {
        if (!profile?.templatePath || profile.sourceType !== "docx") {
          throw new Error(
            "Original DOCX template required. Upload a .docx or use a built-in template.",
          );
        }
        templatePath = profile.templatePath;
      }

      const templateBytes = new Uint8Array(await api.readFileBytes(templatePath));
      const merged = mergeDocxTemplate(templateBytes, data);
      const baseName = `tailored-resume-${Date.now()}`;
      const docxPath = await api.saveExportFile(
        Array.from(merged),
        `${baseName}.docx`,
        "docx",
      );
      if (!docxPath) return null;

      if (sessionId) {
        await api.createOutput({
          sessionId,
          contentJson: JSON.stringify(tailored),
          coverLetter: tailored.cover_letter ?? null,
        });
      }

      if (alsoExportPdf) {
        const pdfPath = await api.convertDocxToPdf(
          docxPath,
          settings?.pdfConverter,
        );
        return { docxPath, pdfPath };
      }

      return { docxPath, pdfPath: null };
    },
    onError: (e) => setError((e as Error).message),
    onSuccess: (result) => {
      if (result) onClose();
    },
  });

  const canUseTemplate =
    !isCoverLetter &&
    profile?.sourceType === "docx" &&
    !!profile.templatePath;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{isCoverLetter ? "Export cover letter" : "Export resume"}</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body">
          {isCoverLetter ? (
            <pre className="output preview-content">{letterText}</pre>
          ) : (
            <fieldset className="export-mode">
              <legend>Template source</legend>
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === "template"}
                  onChange={() => setExportMode("template")}
                  disabled={!canUseTemplate}
                />
                Original template (Mode A)
                {!canUseTemplate && (
                  <span className="muted"> — requires DOCX upload</span>
                )}
              </label>
              {canUseTemplate && placeholders.length > 0 && (
                <p className="muted small">
                  Detected placeholders: {placeholders.join(", ")}
                </p>
              )}
              <label className="radio-label">
                <input
                  type="radio"
                  name="exportMode"
                  checked={exportMode === "builtin"}
                  onChange={() => setExportMode("builtin")}
                />
                Built-in template (Mode C)
              </label>
              {exportMode === "builtin" && (
                <select
                  value={builtinTemplate}
                  onChange={(e) =>
                    setBuiltinTemplate(e.target.value as BuiltinTemplateId)
                  }
                >
                  <option value="modern">Modern</option>
                  <option value="classic">Classic</option>
                  <option value="ats-friendly">ATS-friendly</option>
                </select>
              )}
            </fieldset>
          )}

          {isTauri() && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={alsoExportPdf}
                onChange={(e) => setAlsoExportPdf(e.target.checked)}
              />
              Also export as PDF (Word COM or LibreOffice)
            </label>
          )}

          {!isTauri() && isCoverLetter && (
            <p className="muted small">
              Browser preview exports as plain text. Use the desktop app for
              DOCX/PDF.
            </p>
          )}

          {error && <p className="error">{error}</p>}
        </div>

        <footer className="modal-footer">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            {exportMutation.isPending ? "Exporting..." : "Export"}
          </button>
        </footer>
      </div>
    </div>
  );
}
