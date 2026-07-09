import type { ParsedResume } from "../lib/types";
import { tailoredToPreviewText, type TailoredResume } from "../lib/docx";

interface ResumePreviewProps {
  original: ParsedResume | null;
  tailored: TailoredResume | null;
  tailoredRaw?: string | null;
}

export function ResumePreview({ original, tailored, tailoredRaw }: ResumePreviewProps) {
  const originalText = original?.fullText ?? "No resume loaded.";
  const tailoredText = tailored
    ? tailoredToPreviewText(tailored)
    : tailoredRaw ?? "No tailored output yet.";

  return (
    <div className="preview-split">
      <div className="preview-pane">
        <h4>Original</h4>
        <pre className="preview-content">{originalText}</pre>
      </div>
      <div className="preview-pane">
        <h4>Tailored</h4>
        <pre className="preview-content">{tailoredText}</pre>
      </div>
    </div>
  );
}
