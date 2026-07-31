import { extractSkills } from "./skills.ts";

type PositionedTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PositionedPage = {
  pageNumber: number;
  items: PositionedTextItem[];
};

type ResumeSectionKind =
  | "summary"
  | "experience"
  | "skill"
  | "education"
  | "certification"
  | "project"
  | "publication"
  | "other";

type ResumeSectionHeading = {
  item: PositionedTextItem;
  kind: ResumeSectionKind;
  label: string;
  key: string;
};

type PositionedLine = {
  y: number;
  x: number;
  text: string;
  hasYear: boolean;
};

const POSITIONED_HEADINGS = new Map<
  string,
  { kind: ResumeSectionKind; label: string; key: string }
>([
  ["summary", { kind: "summary", label: "Summary", key: "summary" }],
  [
    "professionalsummary",
    { kind: "summary", label: "Professional Summary", key: "professional-summary" },
  ],
  [
    "selectedimpact",
    { kind: "experience", label: "Selected Impact", key: "selected-impact" },
  ],
  ["experience", { kind: "experience", label: "Experience", key: "experience" }],
  [
    "professionalexperience",
    {
      kind: "experience",
      label: "Professional Experience",
      key: "professional-experience",
    },
  ],
  ["skills", { kind: "skill", label: "Skills", key: "skills" }],
  ["coreskills", { kind: "skill", label: "Core Skills", key: "core-skills" }],
  ["technicalskills", { kind: "skill", label: "Technical Skills", key: "technical-skills" }],
  ["projects", { kind: "project", label: "Projects", key: "projects" }],
  ["education", { kind: "education", label: "Education", key: "education" }],
  [
    "certifications",
    { kind: "certification", label: "Certifications", key: "certifications" },
  ],
  [
    "certification",
    { kind: "certification", label: "Certification", key: "certification" },
  ],
  ["publications", { kind: "publication", label: "Publications", key: "publications" }],
]);

function compactHeading(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function headingFor(item: PositionedTextItem): ResumeSectionHeading | null {
  const heading = POSITIONED_HEADINGS.get(compactHeading(item.text));
  return heading ? { item, ...heading } : null;
}

function joinTextItems(items: PositionedTextItem[]): string {
  const sorted = [...items].sort((left, right) => left.x - right.x);
  let text = "";
  let previousEnd: number | null = null;
  for (const item of sorted) {
    const value = item.text.trim();
    if (!value) continue;
    const gap = previousEnd === null ? 0 : item.x - previousEnd;
    if (text && gap > 1.5 && !/\s$/.test(text)) text += " ";
    text += value;
    previousEnd = item.x + item.width;
  }
  return text.replace(/\s+/g, " ").trim();
}

function positionedLines(items: PositionedTextItem[], tolerance = 2): PositionedLine[] {
  const rows: Array<{ y: number; items: PositionedTextItem[] }> = [];
  for (const item of [...items].sort((left, right) => right.y - left.y || left.x - right.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) {
      row.items.push(item);
    } else {
      rows.push({ y: item.y, items: [item] });
    }
  }
  return rows
    .sort((left, right) => right.y - left.y)
    .map((row) => {
      const text = joinTextItems(row.items);
      return {
        y: row.y,
        x: Math.min(...row.items.map((item) => item.x)),
        text,
        hasYear: /\b(?:19|20)\d{2}\b/.test(text),
      };
    })
    .filter((line) => line.text);
}

function appendWrappedLine(current: string, next: string): string {
  const left = current.trimEnd();
  const right = next.trimStart();
  if (!left) return right;
  if (!right) return left;
  return left.endsWith("-") ? `${left}${right}` : `${left} ${right}`;
}

function joinAllLines(lines: PositionedLine[]): string[] {
  const joined = lines.reduce(
    (text, line) => appendWrappedLine(text, line.text),
    ""
  );
  return joined ? [joined] : [];
}

function impactEntries(items: PositionedTextItem[]): string[] {
  const anchors = items
    .filter((item) => /^\d+(?:\.\d+)?%?\+?$/.test(item.text.trim()))
    .sort((left, right) => left.x - right.x);
  if (anchors.length < 2) return joinAllLines(positionedLines(items));

  return anchors.flatMap((anchor, index) => {
    const nextAnchor = anchors[index + 1];
    const rightEdge = nextAnchor ? nextAnchor.x : Number.POSITIVE_INFINITY;
    const columnItems = items.filter(
      (item) => item.x >= anchor.x - 1 && item.x < rightEdge - 1
    );
    return joinAllLines(positionedLines(columnItems));
  });
}

function experienceEntries(
  items: PositionedTextItem[],
  headingX: number
): string[] {
  const lines = positionedLines(items);
  const entries: string[] = [];
  let wrapped = "";

  const flushWrapped = () => {
    if (wrapped) entries.push(wrapped);
    wrapped = "";
  };

  for (const line of lines) {
    const isHeaderOrLocation = line.hasYear || line.x <= headingX + 3;
    if (isHeaderOrLocation) {
      flushWrapped();
      entries.push(line.text);
      continue;
    }

    wrapped = appendWrappedLine(wrapped, line.text);
    if (/[.!?]$/.test(line.text.trim())) flushWrapped();
  }
  flushWrapped();
  return entries;
}

function defaultSectionEntries(items: PositionedTextItem[]): string[] {
  const lines = positionedLines(items);
  const entries: string[] = [];
  let wrapped = "";
  for (const line of lines) {
    wrapped = appendWrappedLine(wrapped, line.text);
    if (/[.!?]$/.test(line.text.trim())) {
      entries.push(wrapped);
      wrapped = "";
    }
  }
  if (wrapped) entries.push(wrapped);
  return entries;
}

function sectionEntries(
  heading: ResumeSectionHeading,
  items: PositionedTextItem[]
): string[] {
  if (heading.kind === "summary") return joinAllLines(positionedLines(items));
  if (heading.key === "selected-impact") return impactEntries(items);
  if (heading.kind === "experience") {
    return experienceEntries(items, heading.item.x);
  }
  if (heading.kind === "skill") {
    return positionedLines(items).map((line) => line.text);
  }
  return defaultSectionEntries(items);
}

export function reconstructPositionedResumeText(pages: PositionedPage[]): string {
  const output: string[] = [];

  for (const page of pages) {
    const headings = page.items
      .map(headingFor)
      .filter((heading): heading is ResumeSectionHeading => heading !== null)
      .sort(
        (left, right) =>
          right.item.y - left.item.y || left.item.x - right.item.x
      );
    if (headings.length === 0) {
      output.push(...positionedLines(page.items).map((line) => line.text));
      continue;
    }

    if (page.pageNumber === 1) {
      const firstHeadingY = headings[0].item.y;
      const headerItems = page.items.filter((item) => item.y > firstHeadingY + 2);
      output.push(...positionedLines(headerItems).map((line) => line.text));
    }

    const headingRows: Array<{ y: number; headings: ResumeSectionHeading[] }> = [];
    for (const heading of headings) {
      const row = headingRows.find(
        (candidate) => Math.abs(candidate.y - heading.item.y) <= 2
      );
      if (row) row.headings.push(heading);
      else headingRows.push({ y: heading.item.y, headings: [heading] });
    }
    headingRows.sort((left, right) => right.y - left.y);

    headingRows.forEach((row, rowIndex) => {
      const nextY = headingRows[rowIndex + 1]?.y ?? Number.NEGATIVE_INFINITY;
      const rowHeadings = [...row.headings].sort(
        (left, right) => left.item.x - right.item.x
      );
      rowHeadings.forEach((heading, headingIndex) => {
        const previousHeading = rowHeadings[headingIndex - 1];
        const nextHeading = rowHeadings[headingIndex + 1];
        const leftEdge = previousHeading
          ? (previousHeading.item.x + heading.item.x) / 2
          : Number.NEGATIVE_INFINITY;
        const rightEdge = nextHeading
          ? (heading.item.x + nextHeading.item.x) / 2
          : Number.POSITIVE_INFINITY;
        const content = page.items.filter(
          (item) =>
            item !== heading.item &&
            item.y < row.y - 2 &&
            item.y > nextY + 2 &&
            item.x >= leftEdge &&
            item.x < rightEdge
        );
        const entries = sectionEntries(heading, content);
        if (entries.length > 0) {
          output.push(heading.label.toUpperCase(), ...entries);
        }
      });
    });
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function extractPositionedPdfText(buffer: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  try {
    const pages: PositionedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [
          {
            text: item.str,
            x: item.transform[4],
            y: item.transform[5],
            width: item.width,
            height: item.height,
          },
        ];
      });
      pages.push({ pageNumber, items });
      page.cleanup();
    }
    return reconstructPositionedResumeText(pages);
  } finally {
    await document.destroy();
  }
}

export async function extractResumeTextForValidation(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  return extractResumeText(buffer, filename);
}

export async function extractResumeText(buffer: Buffer, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    return extractPositionedPdfText(buffer);
  }

  if (ext === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (ext === "txt") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported resume file type: .${ext}. Use PDF, DOCX, or TXT.`);
}

export function parseResume(text: string) {
  const skills = extractSkills(text);
  return { text, skills };
}
