import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { chromium } from "playwright";
import type Database from "better-sqlite3";
import { extractResumeTextForValidation } from "./resume.ts";
import { extractResumeHeader } from "./resumeEvidence.ts";
import { getResumesDir } from "./runtimePaths.ts";
import { postingFingerprint } from "./jobRequirements.ts";
import {
  getResumeVariant,
  type ResumeVariantItemRow,
} from "./resumeVariants.ts";

export type ResumeArtifactFormat = "docx" | "pdf";

export type ResumeVariantArtifactRow = {
  id: number;
  variant_id: number;
  format: ResumeArtifactFormat;
  file_path: string;
  filename: string;
  sha256: string;
  validation_status: "passed" | "failed";
  validation_json: string;
  created_at: string;
};

type DocumentSection = {
  heading: string;
  kind: string;
  items: ResumeVariantItemRow[];
};

const SECTION_ORDER = [
  ["summary", "Professional Summary"],
  ["skill", "Skills"],
  ["experience", "Experience"],
  ["project", "Projects"],
  ["education", "Education"],
  ["certification", "Certifications"],
  ["publication", "Publications"],
  ["other", "Additional Information"],
] as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeFilenamePart(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[^\x00-\x7F]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
}

function documentSections(items: ResumeVariantItemRow[]): DocumentSection[] {
  const included = items.filter((item) => item.included);
  return SECTION_ORDER.flatMap(([kind, heading]) => {
    const matching = included.filter((item) => item.evidence_kind === kind);
    return matching.length > 0 ? [{ heading, kind, items: matching }] : [];
  });
}

function docxParagraph(
  text: string,
  options: { bold?: boolean; size?: number; center?: boolean; spacingAfter?: number } = {}
): string {
  const runProperties = [
    "<w:rFonts w:ascii=\"Arial\" w:hAnsi=\"Arial\"/>",
    `<w:sz w:val="${options.size ?? 21}"/>`,
    `<w:szCs w:val="${options.size ?? 21}"/>`,
    options.bold ? "<w:b/>" : "",
  ].join("");
  const paragraphProperties = [
    options.center ? '<w:jc w:val="center"/>' : "",
    `<w:spacing w:after="${options.spacingAfter ?? 80}" w:line="240" w:lineRule="auto"/>`,
  ].join("");
  return `<w:p><w:pPr>${paragraphProperties}</w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

async function renderDocx(header: string[], sections: DocumentSection[]): Promise<Buffer> {
  const body: string[] = [];
  header.forEach((line, index) => {
    body.push(
      docxParagraph(line, {
        bold: index === 0,
        size: index === 0 ? 32 : 20,
        center: true,
        spacingAfter: index === header.length - 1 ? 180 : 20,
      })
    );
  });
  for (const section of sections) {
    body.push(docxParagraph(section.heading.toUpperCase(), { bold: true, size: 23, spacingAfter: 60 }));
    if (section.kind === "skill") {
      body.push(docxParagraph(section.items.map((item) => item.tailored_text).join(", ")));
    } else {
      for (const item of section.items) {
        body.push(docxParagraph(item.tailored_text));
      }
    }
  }
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${body.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="936" w:right="936" w:bottom="936" w:left="936" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault>
  </w:docDefaults>
</w:styles>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
  );
  zip.folder("_rels")?.file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.folder("word")?.file("document.xml", documentXml);
  zip.folder("word")?.file("styles.xml", stylesXml);
  zip.folder("word")?.folder("_rels")?.file(
    "document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function renderPdf(header: string[], sections: DocumentSection[]): Promise<Buffer> {
  const sectionHtml = sections
    .map((section) => {
      const content =
        section.kind === "skill"
          ? `<p>${section.items.map((item) => htmlEscape(item.tailored_text)).join(", ")}</p>`
          : section.items
              .map((item) => `<p>${htmlEscape(item.tailored_text)}</p>`)
              .join("");
      return `<section><h2>${htmlEscape(section.heading)}</h2>${content}</section>`;
    })
    .join("");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page { size: Letter; margin: 0.65in; }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body { margin: 0; color: #111; font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.28; }
  header { text-align: center; margin-bottom: 14pt; }
  header h1 { margin: 0 0 3pt; font-size: 16pt; }
  header p { margin: 1pt 0; }
  section { break-inside: auto; margin-top: 10pt; }
  h2 { margin: 0 0 4pt; padding-bottom: 2pt; border-bottom: 0.6pt solid #333; font-size: 11pt; letter-spacing: 0.3pt; text-transform: uppercase; }
  p { margin: 0 0 4pt; orphans: 2; widows: 2; }
</style></head><body>
<header><h1>${htmlEscape(header[0] ?? "")}</h1>${header
    .slice(1)
    .map((line) => `<p>${htmlEscape(line)}</p>`)
    .join("")}</header>
${sectionHtml}
</body></html>`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "Letter",
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: "0.65in", right: "0.65in", bottom: "0.65in", left: "0.65in" },
    });
  } finally {
    await browser.close();
  }
}

function normalizeExtractedText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeValidationWords(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function artifactTextContainsExpected(
  parsedText: string,
  expectedLine: string
): boolean {
  const normalizedParsed = normalizeExtractedText(parsedText);
  const normalizedExpected = normalizeExtractedText(expectedLine);
  if (normalizedParsed.includes(normalizedExpected)) return true;

  const expectedWords = normalizeValidationWords(expectedLine);
  const wordCount = expectedWords ? expectedWords.split(" ").length : 0;
  if (wordCount < 3) return false;
  return normalizeValidationWords(parsedText).includes(expectedWords);
}

async function validateArtifact(
  buffer: Buffer,
  format: ResumeArtifactFormat,
  expectedLines: string[]
) {
  const parsed = await extractResumeTextForValidation(
    buffer,
    `tailored-resume.${format}`
  );
  const missing = expectedLines.filter(
    (line) => !artifactTextContainsExpected(parsed, line)
  );
  return {
    passed: missing.length === 0,
    expectedItemCount: expectedLines.length,
    missingItemCount: missing.length,
    missingItems: missing,
    parsedCharacterCount: parsed.length,
  };
}

function contactHeaderIsUsable(header: string[]): boolean {
  return header.length > 0 && header.some((line) =>
    /@|(?:https?:\/\/|www\.|linkedin\.com|github\.com)|(?:\+?\d[\d\s().-]{7,}\d)/i.test(
      line
    )
  );
}

export async function generateResumeArtifacts(
  db: Database.Database,
  variantId: number,
  context: {
    resumeText: string;
    resumeFilename: string;
    company: string;
    jobTitle: string;
  }
) {
  const loaded = getResumeVariant(db, variantId);
  if (!loaded || loaded.variant.status !== "approved") {
    throw new Error("Only an approved resume variant can be exported");
  }
  const included = loaded.items.filter((item) => item.included);
  if (included.length === 0) throw new Error("The approved variant has no included evidence");
  const header = extractResumeHeader(context.resumeText);
  if (!contactHeaderIsUsable(header)) {
    throw new Error(
      "The master resume header must include a name and recognizable contact detail"
    );
  }
  const sections = documentSections(included);
  const expectedLines = [...header, ...included.map((item) => item.tailored_text)];
  const baseName =
    safeFilenamePart(path.parse(context.resumeFilename).name) || "Resume";
  const suffix = [safeFilenamePart(context.company), safeFilenamePart(context.jobTitle)]
    .filter(Boolean)
    .join("_");
  const filenameBase = `${baseName}_${suffix || "Tailored"}`;
  const outputDir = path.join(getResumesDir(), "variants", String(variantId));
  fs.mkdirSync(outputDir, { recursive: true });

  const rendered = await Promise.all([
    renderDocx(header, sections).then((buffer) => ({ format: "docx" as const, buffer })),
    renderPdf(header, sections).then((buffer) => ({ format: "pdf" as const, buffer })),
  ]);
  const results = [];
  for (const artifact of rendered) {
    const validation = await validateArtifact(
      artifact.buffer,
      artifact.format,
      expectedLines
    );
    const filename = `${filenameBase}.${artifact.format}`;
    const filePath = validation.passed ? path.join(outputDir, filename) : "";
    if (validation.passed) {
      fs.writeFileSync(filePath, artifact.buffer);
    }
    const sha256 = createHash("sha256").update(artifact.buffer).digest("hex");
    db.prepare(
      `INSERT INTO resume_variant_artifacts
         (variant_id, format, file_path, filename, sha256,
          validation_status, validation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(variant_id, format) DO UPDATE SET
         file_path = excluded.file_path,
         filename = excluded.filename,
         sha256 = excluded.sha256,
         validation_status = excluded.validation_status,
         validation_json = excluded.validation_json,
         created_at = datetime('now')`
    ).run(
      variantId,
      artifact.format,
      filePath,
      filename,
      sha256,
      validation.passed ? "passed" : "failed",
      JSON.stringify(validation)
    );
    results.push({
      format: artifact.format,
      filename,
      validationStatus: validation.passed ? ("passed" as const) : ("failed" as const),
      validation: {
        expectedItemCount: validation.expectedItemCount,
        missingItemCount: validation.missingItemCount,
        parsedCharacterCount: validation.parsedCharacterCount,
      },
    });
  }
  return results;
}

export function getResumeArtifactSummaries(db: Database.Database, variantId: number) {
  const rows = db
    .prepare(
      `SELECT * FROM resume_variant_artifacts
       WHERE variant_id = ?
       ORDER BY CASE format WHEN 'docx' THEN 0 ELSE 1 END`
    )
    .all(variantId) as ResumeVariantArtifactRow[];
  return rows.map((row) => {
    let validation: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(row.validation_json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        validation = parsed as Record<string, unknown>;
      }
    } catch {
      validation = {};
    }
    return {
      format: row.format,
      filename: row.filename,
      validationStatus: row.validation_status,
      validation: {
        expectedItemCount: validation.expectedItemCount ?? 0,
        missingItemCount: validation.missingItemCount ?? 0,
        parsedCharacterCount: validation.parsedCharacterCount ?? 0,
      },
      downloadUrl:
        row.validation_status === "passed"
          ? `/api/resume-variants/${variantId}/download/${row.format}`
          : null,
      createdAt: row.created_at,
    };
  });
}

export function getValidatedArtifact(
  db: Database.Database,
  variantId: number,
  format: ResumeArtifactFormat
): ResumeVariantArtifactRow | null {
  return (
    (db
      .prepare(
        `SELECT * FROM resume_variant_artifacts
         WHERE variant_id = ? AND format = ? AND validation_status = 'passed'`
      )
      .get(variantId, format) as ResumeVariantArtifactRow | undefined) ?? null
  );
}

export type ResumeAttachmentSelection = {
  source: "tailored" | "master";
  filePath: string;
  filename: string;
  format: "docx" | "pdf" | "txt" | null;
  variantId: number | null;
};

export function selectResumeAttachmentForJob(
  db: Database.Database,
  job: { id: number; description: string | null },
  masterResume:
    | { id: number; filename: string; file_path: string | null }
    | undefined
): ResumeAttachmentSelection | null {
  if (masterResume) {
    const tailoredCandidates = db
      .prepare(
        `SELECT
           artifacts.file_path,
           artifacts.filename,
           artifacts.format,
           variants.id AS variant_id
         FROM resume_variants variants
         JOIN resume_variant_artifacts artifacts
           ON artifacts.variant_id = variants.id
         WHERE variants.job_id = ?
           AND variants.resume_id = ?
           AND variants.status = 'approved'
           AND variants.job_fingerprint = ?
           AND artifacts.validation_status = 'passed'
           AND artifacts.file_path <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM resume_variant_items items
             LEFT JOIN resume_evidence evidence ON evidence.id = items.evidence_id
             WHERE items.variant_id = variants.id
               AND items.included = 1
               AND (
                 evidence.id IS NULL
                 OR evidence.verification_status <> 'verified'
                 OR evidence.normalized_text <> items.original_text
               )
           )
         ORDER BY
           CASE
             WHEN artifacts.format = variants.preferred_format THEN 0
             WHEN artifacts.format = 'docx' THEN 1
             ELSE 2
           END`
      )
      .all(
        job.id,
        masterResume.id,
        postingFingerprint(job.description?.trim() ?? "")
      ) as Array<{
          file_path: string;
          filename: string;
          format: "docx" | "pdf";
          variant_id: number;
        }>;
    const tailored = tailoredCandidates.find((candidate) =>
      fs.existsSync(candidate.file_path)
    );
    if (tailored) {
      return {
        source: "tailored",
        filePath: tailored.file_path,
        filename: tailored.filename,
        format: tailored.format,
        variantId: tailored.variant_id,
      };
    }
  }

  if (!masterResume?.file_path || !fs.existsSync(masterResume.file_path)) return null;
  const extension = path.extname(masterResume.filename).toLowerCase().slice(1);
  return {
    source: "master",
    filePath: masterResume.file_path,
    filename: masterResume.filename,
    format:
      extension === "docx" || extension === "pdf" || extension === "txt"
        ? extension
        : null,
    variantId: null,
  };
}
