import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

export interface TailoredResume {
  name?: string;
  contact?: string;
  summary?: string;
  experience?: Array<{
    title?: string;
    company?: string;
    bullets?: string[];
  }>;
  skills?: string | string[];
  education?: string | Array<{ degree?: string; school?: string; year?: string }>;
  cover_letter?: string;
  [key: string]: unknown;
}

export function parseTailoredJson(raw: string): TailoredResume {
  const cleaned = raw.trim();
  try {
    return JSON.parse(cleaned) as TailoredResume;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as TailoredResume;
    }
    throw new Error("Could not parse tailored output as JSON");
  }
}

export function tailoredToTemplateData(tailored: TailoredResume): Record<string, string> {
  const experience =
    tailored.experience
      ?.map((exp) => {
        const header = [exp.title, exp.company].filter(Boolean).join(" — ");
        const bullets = (exp.bullets ?? []).map((b) => `• ${b}`).join("\n");
        return [header, bullets].filter(Boolean).join("\n");
      })
      .join("\n\n") ?? "";

  const skills = Array.isArray(tailored.skills)
    ? tailored.skills.join(", ")
    : (tailored.skills ?? "");

  const education = Array.isArray(tailored.education)
    ? tailored.education
        .map((e) => [e.degree, e.school, e.year].filter(Boolean).join(", "))
        .join("\n")
    : (tailored.education ?? "");

  return {
    name: tailored.name ?? "",
    contact: tailored.contact ?? "",
    summary: tailored.summary ?? "",
    experience,
    skills,
    education,
    cover_letter: tailored.cover_letter ?? "",
  };
}

export function mergeDocxTemplate(
  templateBytes: Uint8Array,
  data: Record<string, string>,
): Uint8Array {
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "uint8array", compression: "DEFLATE" });
}

export function tailoredToPreviewText(tailored: TailoredResume): string {
  const parts: string[] = [];
  if (tailored.summary) {
    parts.push(`SUMMARY\n${tailored.summary}`);
  }
  if (tailored.experience?.length) {
    const exp = tailored.experience
      .map((e) => {
        const header = [e.title, e.company].filter(Boolean).join(" @ ");
        const bullets = (e.bullets ?? []).map((b) => `  • ${b}`).join("\n");
        return `${header}\n${bullets}`;
      })
      .join("\n\n");
    parts.push(`EXPERIENCE\n${exp}`);
  }
  if (tailored.skills) {
    const skills = Array.isArray(tailored.skills)
      ? tailored.skills.join(", ")
      : tailored.skills;
    parts.push(`SKILLS\n${skills}`);
  }
  if (tailored.education) {
    const edu = Array.isArray(tailored.education)
      ? tailored.education
          .map((e) => [e.degree, e.school, e.year].filter(Boolean).join(", "))
          .join("\n")
      : tailored.education;
    parts.push(`EDUCATION\n${edu}`);
  }
  return parts.join("\n\n");
}
