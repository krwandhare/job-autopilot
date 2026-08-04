import Anthropic from "@anthropic-ai/sdk";
import type { EvidenceKind } from "./resumeEvidence";

// Only free-text/narrative evidence is worth an LLM rewrite. Single-token
// kinds (skill, certification, education, other) stay on the existing
// deterministic formatEvidenceText() path in resumeVariants.ts -- there is
// nothing for a "smart generation engine" to usefully rephrase in "Kubernetes"
// or "B.E., Electronics Engineering", and sending them just adds cost/risk.
const TAILORABLE_KINDS = new Set<EvidenceKind>([
  "summary",
  "experience",
  "project",
  "publication",
]);

export function isEvidenceKindTailorable(kind: EvidenceKind): boolean {
  return TAILORABLE_KINDS.has(kind);
}

export function isLLMTailoringConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export type TailorableItem = {
  evidenceId: number;
  kind: EvidenceKind;
  text: string;
};

export class LLMTailoringError extends Error {
  code: "not_configured" | "refusal" | "truncated" | "no_tool_call" | "invalid_response" | "api_error";
  constructor(message: string, code: LLMTailoringError["code"]) {
    super(message);
    this.name = "LLMTailoringError";
    this.code = code;
  }
}

const MODEL = "claude-opus-5";

// The LLM's only job is content -- which existing, verified facts to
// emphasize and how to phrase them. It never sees or controls layout,
// formatting, dates, employer names, or titles: those come from the
// database and are rendered by the existing deterministic DOCX/PDF
// template, untouched by this module. See resumeVariants.ts.
const SYSTEM_PROMPT = `You are a resume content-tailoring engine. You are given verified evidence items from a candidate's resume and a target job description. For each item, decide how to phrase it to best emphasize its relevance to the job description, without changing what it claims.

Hard constraints:
- Every fact in your tailored text must already be present in that item's original text. Never add a skill, technology, employer, metric, responsibility, or claim that is not there.
- Do not merge multiple items together and do not split one item into several.
- You may reorder clauses, choose stronger verbs, tighten phrasing, and surface terms from the job description only when the underlying fact already supports them.
- If an item is already optimally phrased for this job description, return it unchanged.
- Return exactly one tailored entry for every item id you were given, and no others.

Call the submit_tailored_resume_items tool with your result. Do not respond with any text outside that tool call.`;

const TOOL_NAME = "submit_tailored_resume_items";

const TAILOR_TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: "Submit tailored phrasing for each provided resume evidence item.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "integer", description: "The evidence item id, echoed back unchanged." },
            tailoredText: { type: "string", description: "The tailored phrasing for this item." },
          },
          required: ["id", "tailoredText"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  },
};

type ToolResult = { items: { id: number; tailoredText: string }[] };

function isValidToolResult(value: unknown): value is ToolResult {
  if (!value || typeof value !== "object" || !Array.isArray((value as ToolResult).items)) {
    return false;
  }
  return (value as ToolResult).items.every(
    (item) =>
      item &&
      typeof item.id === "number" &&
      typeof item.tailoredText === "string"
  );
}

// A tailored line that shares almost none of the original's significant
// words, or that has ballooned far past its source length, is more likely
// fabricated than tailored -- reject rather than silently accept. This is
// a coarse backstop behind the system prompt's grounding instruction, not
// a substitute for it.
function looksGrounded(original: string, tailored: string): boolean {
  const trimmed = tailored.trim();
  if (!trimmed) return false;
  if (trimmed.length > original.length * 3 + 40) return false;
  const words = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 3)
    );
  const originalWords = words(original);
  if (originalWords.size === 0) return true;
  const tailoredWords = words(tailored);
  const overlap = [...originalWords].filter((w) => tailoredWords.has(w)).length;
  return overlap / originalWords.size >= 0.3;
}

async function callModel(
  client: Anthropic,
  userContent: string,
  maxTokens: number
): Promise<Anthropic.Message> {
  return client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: SYSTEM_PROMPT,
    tools: [TAILOR_TOOL],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages: [{ role: "user", content: userContent }],
  });
}

// Tailors free-text evidence items against a job description via a single
// forced tool call (no free text, no markdown -- see TAILOR_TOOL's
// strict:true schema). Throws LLMTailoringError on any failure rather than
// returning partial/guessed results; callers decide whether to fall back to
// the deterministic path or surface the error.
export async function tailorEvidenceText(
  items: TailorableItem[],
  jobDescription: string
): Promise<Map<number, string>> {
  if (items.length === 0) return new Map();
  if (!isLLMTailoringConfigured()) {
    throw new LLMTailoringError("ANTHROPIC_API_KEY is not configured", "not_configured");
  }

  const client = new Anthropic();
  const userContent = JSON.stringify({
    jobDescription,
    items: items.map((item) => ({ id: item.evidenceId, kind: item.kind, text: item.text })),
  });

  let maxTokens = 8000;
  let response: Anthropic.Message;
  try {
    response = await callModel(client, userContent, maxTokens);
    if (response.stop_reason === "max_tokens") {
      maxTokens = Math.min(maxTokens * 2, 16000);
      response = await callModel(client, userContent, maxTokens);
    }
  } catch (err) {
    throw new LLMTailoringError(
      `Anthropic API request failed: ${err instanceof Error ? err.message : String(err)}`,
      "api_error"
    );
  }

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category ?? null;
    throw new LLMTailoringError(
      `Model declined the request${category ? ` (category: ${category})` : ""}`,
      "refusal"
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new LLMTailoringError("Response truncated at max_tokens after retry", "truncated");
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === TOOL_NAME
  );
  if (!toolUse) {
    throw new LLMTailoringError(
      `Expected a forced tool call but got stop_reason "${response.stop_reason}"`,
      "no_tool_call"
    );
  }
  if (!isValidToolResult(toolUse.input)) {
    throw new LLMTailoringError("Tool call input did not match the expected schema", "invalid_response");
  }

  const requestedIds = new Set(items.map((item) => item.evidenceId));
  const returnedIds = new Set(toolUse.input.items.map((item) => item.id));
  if (
    requestedIds.size !== returnedIds.size ||
    [...requestedIds].some((id) => !returnedIds.has(id))
  ) {
    throw new LLMTailoringError(
      "Tailored item ids did not match the requested evidence ids",
      "invalid_response"
    );
  }

  const originalById = new Map(items.map((item) => [item.evidenceId, item.text]));
  const result = new Map<number, string>();
  for (const entry of toolUse.input.items) {
    const original = originalById.get(entry.id) ?? "";
    if (!looksGrounded(original, entry.tailoredText)) {
      throw new LLMTailoringError(
        `Tailored text for evidence ${entry.id} failed the grounding check`,
        "invalid_response"
      );
    }
    result.set(entry.id, entry.tailoredText.trim());
  }
  return result;
}
