import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import {
  mergeDocxTemplate,
  tailoredToTemplateData,
  type TailoredResume,
} from "../lib/docx";
import { useAppSettings } from "../lib/settings";

export type ExportMode = "template" | "builtin";
export type BuiltinTemplateId = "modern" | "classic" | "ats-friendly";

interface ExportDialogProps {
  profileId: string;
  tailored: TailoredResume;
  sessionId?: string;
  onClose: () => void;
}

export function ExportDialog({
  profileId,
  tailored,
  sessionId,
  onClose,
}: ExportDialogProps) {
  const [exportMode, setExportMode] = useState<ExportMode>("template");
  const [builtinTemplate, setBuiltinTemplate] =
    useState<BuiltinTemplateId>("modern");
  const [includeCoverLetter, setIncludeCoverLetter] = useState(false);
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
    enabled: !!profile?.templatePath && profile.sourceType === "docx",
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
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

      if (includeCoverLetter && tailored.cover_letter) {
        const coverData = { cover_letter: tailored.cover_letter };
        const coverMerged = mergeDocxTemplate(
          new Uint8Array(await api.readFileBytes(templatePath)),
          {
          ...data,
          summary: tailored.cover_letter,
          experience: "",
          skills: "",
          education: "",
          ...coverData,
        });
        await api.saveExportFile(
          Array.from(coverMerged),
          `${baseName}-cover-letter.docx`,
          "docx",
        );
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
    profile?.sourceType === "docx" && !!profile.templatePath;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Export resume</h3>
          <button type="button" className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="modal-body">
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

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeCoverLetter}
              onChange={(e) => setIncludeCoverLetter(e.target.checked)}
              disabled={!tailored.cover_letter}
            />
            Export cover letter separately
            {!tailored.cover_letter && (
              <span className="muted"> (no cover letter in output)</span>
            )}
          </label>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={alsoExportPdf}
              onChange={(e) => setAlsoExportPdf(e.target.checked)}
            />
            Also export as PDF (Word COM or LibreOffice)
          </label>

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
