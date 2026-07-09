/**
 * Generates minimal DOCX templates for Mode C export.
 * Run: node scripts/generate-templates.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import JSZip from "pizzip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "..", "templates");
mkdirSync(outDir, { recursive: true });

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

function paragraph(text, opts = {}) {
  const { bold = false, size = 22, center = false } = opts;
  const align = center
    ? '<w:jc w:val="center"/>'
    : "";
  const boldTag = bold ? "<w:b/>" : "";
  return `<w:p>
    <w:pPr>${align}</w:pPr>
    <w:r>
      <w:rPr>${boldTag}<w:sz w:val="${size}"/></w:rPr>
      <w:t xml:space="preserve">${escapeXml(text)}</w:t>
    </w:r>
  </w:p>`;
}

function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildDocument(bodyParagraphs) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyParagraphs.join("\n")}
    <w:sectPr/>
  </w:body>
</w:document>`;
}

function createDocx(filename, bodyParagraphs) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.folder("_rels").file(".rels", RELS);
  const word = zip.folder("word");
  word.file("document.xml", buildDocument(bodyParagraphs));
  word.folder("_rels").file("document.xml.rels", DOC_RELS);
  const buf = zip.generate({ type: "nodebuffer" });
  writeFileSync(join(outDir, filename), buf);
  console.log(`Created ${filename}`);
}

// Modern template
createDocx("modern.docx", [
  paragraph("{name}", { bold: true, size: 32, center: true }),
  paragraph("{contact}", { center: true, size: 20 }),
  paragraph(""),
  paragraph("SUMMARY", { bold: true, size: 24 }),
  paragraph("{summary}"),
  paragraph(""),
  paragraph("EXPERIENCE", { bold: true, size: 24 }),
  paragraph("{experience}"),
  paragraph(""),
  paragraph("SKILLS", { bold: true, size: 24 }),
  paragraph("{skills}"),
  paragraph(""),
  paragraph("EDUCATION", { bold: true, size: 24 }),
  paragraph("{education}"),
]);

// Classic template
createDocx("classic.docx", [
  paragraph("{name}", { bold: true, size: 28 }),
  paragraph("{contact}", { size: 20 }),
  paragraph("───────────────────────────────────────"),
  paragraph("Professional Summary", { bold: true }),
  paragraph("{summary}"),
  paragraph(""),
  paragraph("Work Experience", { bold: true }),
  paragraph("{experience}"),
  paragraph(""),
  paragraph("Skills", { bold: true }),
  paragraph("{skills}"),
  paragraph(""),
  paragraph("Education", { bold: true }),
  paragraph("{education}"),
]);

// ATS-friendly template (plain, no fancy formatting)
createDocx("ats-friendly.docx", [
  paragraph("{name}", { bold: true }),
  paragraph("{contact}"),
  paragraph(""),
  paragraph("SUMMARY"),
  paragraph("{summary}"),
  paragraph(""),
  paragraph("EXPERIENCE"),
  paragraph("{experience}"),
  paragraph(""),
  paragraph("SKILLS"),
  paragraph("{skills}"),
  paragraph(""),
  paragraph("EDUCATION"),
  paragraph("{education}"),
]);
