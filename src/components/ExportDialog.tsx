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

  const [alsoExportPdf, setAlsoExportPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: settings } = useAppSettings();

  const { data: profile } = useQuery({
    queryKey: ["profile", profileId],
    queryFn: () => api.getProfile(profileId),
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!isTauri()) {
        throw new Error("Export requires the desktop app (npm run tauri dev).");
      }

      const templatePath = await api.ensureProfileExportTemplate(profileId);
      const templateBytes = new Uint8Array(await api.readFileBytes(templatePath));

      if (isCoverLetter) {
        if (!letterText) throw new Error("No cover letter to export");
        const data = tailoredToTemplateData({
          name: profile?.name ?? "",
          cover_letter: letterText,
          summary: letterText,
        });
        const merged = mergeDocxTemplate(templateBytes, data);
        const baseName = `cover-letter-${Date.now()}`;
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
          <p className="muted small">
            Exports use your uploaded resume&apos;s original DOCX formatting
            (fonts, margins, layout). Re-upload a .docx in Profiles if export is
            unavailable.
          </p>

          {isCoverLetter ? (
            <pre className="output preview-content">{letterText}</pre>
          ) : (
            tailored && (
              <p className="muted small">
                Merging tailored content into{" "}
                <strong>{profile?.name ?? "your template"}</strong>.
              </p>
            )
          )}

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={alsoExportPdf}
              onChange={(e) => setAlsoExportPdf(e.target.checked)}
            />
            Also export as PDF (Microsoft Word or LibreOffice)
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
