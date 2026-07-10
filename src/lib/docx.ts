import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { ParsedResume } from "./types";

export interface TailoredResume {
  name?: string;
  contact?: string;
  summary?: string;
  experience?: Array<{
    title?: string;
    company?: string;
    dates?: string;
    bullets?: string[];
  }>;
  skills?: string | string[];
  education?: string | Array<{ degree?: string; school?: string; year?: string }>;
  cover_letter?: string;
  [key: string]: unknown;
}

function asString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    const parts = Object.values(value as Record<string, unknown>)
      .map(asString)
      .filter((part): part is string => !!part);
    return parts.length ? parts.join(" | ") : undefined;
  }
  return undefined;
}

function normalizeBullets(bullets: unknown): string[] {
  if (!bullets) return [];
  if (Array.isArray(bullets)) {
    return bullets.map((bullet) => asString(bullet)).filter((bullet): bullet is string => !!bullet);
  }
  const single = asString(bullets);
  return single ? [single] : [];
}

function normalizeExperienceEntry(
  experience: unknown,
): NonNullable<TailoredResume["experience"]>[number] | null {
  if (!experience || typeof experience !== "object") return null;
  const record = experience as Record<string, unknown>;
  return {
    title: asString(record.title),
    company: asString(record.company),
    dates: asString(record.dates),
    bullets: normalizeBullets(record.bullets),
  };
}

function normalizeExperience(
  experience: TailoredResume["experience"] | unknown,
): TailoredResume["experience"] {
  if (!experience) return undefined;
  if (Array.isArray(experience)) {
    return experience
      .map(normalizeExperienceEntry)
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }
  if (typeof experience === "string" && experience.trim()) {
    return [{ bullets: [experience.trim()] }];
  }
  return undefined;
}

function normalizeSkills(skills: unknown): string | string[] | undefined {
  if (!skills) return undefined;
  if (typeof skills === "string") {
    const trimmed = skills.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(skills)) {
    const list = skills.map((skill) => asString(skill)).filter((skill): skill is string => !!skill);
    return list.length ? list : undefined;
  }
  return asString(skills);
}

/** Coerce LLM JSON into safe shapes so render/export never throw on bad fields. */
export function normalizeTailoredResume(tailored: TailoredResume): TailoredResume {
  return {
    ...tailored,
    name: asString(tailored.name),
    contact: asString(tailored.contact),
    summary: asString(tailored.summary),
    experience: normalizeExperience(tailored.experience),
    skills: normalizeSkills(tailored.skills),
    cover_letter: asString(tailored.cover_letter),
  };
}

export function parseTailoredJson(raw: string): TailoredResume {
  const cleaned = raw.trim();
  let parsed: TailoredResume;
  try {
    parsed = JSON.parse(cleaned) as TailoredResume;
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1)) as TailoredResume;
    } else {
      throw new Error("Could not parse tailored output as JSON");
    }
  }
  return normalizeTailoredResume(parsed);
}

function sectionContent(parsed: ParsedResume | null, pattern: RegExp): string {
  if (!parsed?.sections) return "";
  const section = parsed.sections.find((s) => pattern.test(s.name));
  return section?.content?.trim() ?? "";
}

export function extractHeaderFromResume(parsed: ParsedResume | null): {
  name: string;
  contact: string;
} {
  if (!parsed) return { name: "", contact: "" };

  if (!parsed?.sections) {
    const lines = parsed?.fullText?.split("\n").map((l) => l.trim()).filter(Boolean) ?? [];
    return {
      name: lines[0] ?? "",
      contact: lines.slice(1, 4).join(" | "),
    };
  }

  const header = parsed.sections.find((s) => s.name.toLowerCase() === "header");
  if (header) {
    const lines = header.content.split("\n").map((l) => l.trim()).filter(Boolean);
    return {
      name: lines[0] ?? "",
      contact: lines.slice(1).join(" | "),
    };
  }

  const lines = parsed.fullText.split("\n").map((l) => l.trim()).filter(Boolean);
  return {
    name: lines[0] ?? "",
    contact: lines.slice(1, 4).join(" | "),
  };
}

/** Fill missing tailor fields from the source resume so export/preview stay complete. */
export function mergeTailoredWithResume(
  tailored: TailoredResume,
  source: ParsedResume | null,
): TailoredResume {
  const normalized = normalizeTailoredResume(tailored);
  if (!source) return normalized;

  const { name, contact } = extractHeaderFromResume(source);
  const sourceSkills = sectionContent(source, /skill/i);
  const sourceEducation = sectionContent(source, /education/i);
  const sourceSummary = sectionContent(source, /summary|profile|objective/i);

  const skills =
    normalized.skills ??
    (sourceSkills
      ? sourceSkills
          .split(/[\n,•|]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined);

  return {
    ...normalized,
    name: normalized.name || name,
    contact: normalized.contact || contact,
    summary: normalized.summary || sourceSummary || normalized.summary,
    skills: skills ?? normalized.skills,
    education: normalized.education ?? sourceEducation ?? normalized.education,
    experience: normalized.experience?.map((exp) => ({
      ...exp,
      dates: exp.dates?.trim() || undefined,
      bullets: normalizeBullets(exp.bullets),
    })),
  };
}

function formatExperience(exp: TailoredResume["experience"]): string {
  return (
    exp
      ?.map((job) => {
        const headerParts = [job.title, job.company].filter(Boolean);
        const header = headerParts.join(" — ");
        const datedHeader = job.dates
          ? header
            ? `${header} (${job.dates})`
            : job.dates
          : header;
        const bullets = normalizeBullets(job.bullets).map((b) => `• ${b}`).join("\n");
        return [datedHeader, bullets].filter(Boolean).join("\n");
      })
      .join("\n\n") ?? ""
  );
}

export function tailoredToTemplateData(
  tailored: TailoredResume,
): Record<string, string> {
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
    experience: formatExperience(tailored.experience),
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

  if (tailored.name) {
    parts.push(tailored.name);
  }
  if (tailored.contact) {
    parts.push(tailored.contact);
  }
  if (tailored.summary) {
    parts.push(`SUMMARY\n${tailored.summary}`);
  }
  if (tailored.experience?.length) {
    const exp = formatExperience(tailored.experience);
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
