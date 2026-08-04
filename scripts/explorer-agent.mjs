#!/usr/bin/env node
// Explorer-agent: a read-only reconnaissance crawler for Job Autopilot's own
// UI, used to produce a JSON state-machine map of the app plus a generated
// E2E test plan. See docs/explorer-agent/README.md for the full design and
// safety rationale.
//
// SAFETY: this script only ever navigates (page.goto) and reads the DOM. It
// never clicks, types into, or submits anything -- several buttons in this
// app (Start Auto-fill, Submit, Delete, Sync...) are real, state-mutating
// actions that AGENTS.md reserves for explicit, user-authorized action.
// Those are only ever *cataloged* here for manual review, never invoked.
//
// It also never captures per-record dynamic content (link text, input
// values, <option> contents) -- only element type/attributes and
// <button>/<label> text, which in this codebase are static JSX copy, not
// data pulled from the database. See AGENTS.md's privacy rules.
//
// Usage:
//   npm run explorer-agent -- --base-url http://localhost:3000
//
// Requires a dev server already running at --base-url; this script never
// starts one itself.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildRouteTemplates, matchRoutePattern } from "../lib/explorer/routes.ts";
import { classifyElement, elementDedupeKey } from "../lib/explorer/classify.ts";

function parseArgs(argv) {
  const args = {
    baseUrl: "http://localhost:3000",
    maxPages: 40,
    outDir: "docs/explorer-agent",
    headless: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url") args.baseUrl = argv[++i];
    else if (arg === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (arg === "--out-dir") args.outDir = argv[++i];
    else if (arg === "--headed") args.headless = false;
  }
  return args;
}

// Discovers this app's real page routes from app/**/page.tsx (skipping
// app/api and Next.js route groups) so concrete crawled paths like
// "/jobs/17" can be normalized to the app's actual "/jobs/[id]" pattern
// instead of guessing.
function collectPageRoutes(appDir) {
  const templates = [];
  function walk(dir, segments) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === "page.tsx")) {
      templates.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "api") continue;
      const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
      walk(path.join(dir, entry.name), isGroup ? segments : [...segments, entry.name]);
    }
  }
  walk(appDir, []);
  return templates;
}

function collectApiRoutes(apiDir) {
  const templates = [];
  if (!fs.existsSync(apiDir)) return templates;
  function walk(dir, segments) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    if (entries.some((e) => e.isFile() && e.name === "route.ts")) {
      templates.push(`/api/${segments.join("/")}`);
    }
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), [...segments, entry.name]);
    }
  }
  walk(apiDir, []);
  return templates;
}

async function checkReachable(baseUrl) {
  try {
    const res = await fetch(baseUrl);
    return res.status < 500;
  } catch {
    return false;
  }
}

// Runs inside the browser via page.evaluate -- must be self-contained (no
// closures over outer scope). Deliberately never reads <a> text, input
// `value`s, or <select> option contents: those can carry real job/resume
// data. Only element type/attributes and static <button>/<label> text.
function extractPageData() {
  function computeLabel(el) {
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor && byFor.textContent) return byFor.textContent.replace(/\s+/g, " ").trim();
    }
    const wrapping = el.closest("label");
    if (wrapping && wrapping.textContent) return wrapping.textContent.replace(/\s+/g, " ").trim();
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim();
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder.trim();
    return el.getAttribute("name") || "";
  }

  const origin = window.location.origin;
  const links = new Set();
  const resourceHrefs = new Set();
  document.querySelectorAll("a[href]").forEach((a) => {
    const raw = a.getAttribute("href") || "";
    if (!raw || raw.startsWith("#") || raw.startsWith("mailto:") || raw.startsWith("tel:")) return;
    let absolute;
    try {
      absolute = new URL(raw, origin);
    } catch {
      return;
    }
    if (absolute.origin !== origin) return;
    if (absolute.pathname.startsWith("/api/")) resourceHrefs.add(absolute.pathname);
    else links.add(absolute.pathname);
  });

  const elements = [];

  document.querySelectorAll("form").forEach((f) => {
    elements.push({ tag: "form", method: (f.getAttribute("method") || "get").toLowerCase() });
  });

  document.querySelectorAll("button").forEach((b) => {
    if (b.disabled) return;
    const text = (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    // A button's `title` attribute is classification-only signal (see
    // ExtractedElement.title): some buttons here keep short visible text for
    // layout but put the real description in `title` (e.g. "Fill" titled
    // "Auto-fill (review before submit)"). Static JSX in every case, never
    // per-record dynamic content.
    const title = (b.getAttribute("title") || "").trim().slice(0, 120);
    elements.push({ tag: "button", type: b.getAttribute("type") || "button", label: text, title });
  });

  document.querySelectorAll("input, textarea, select").forEach((el) => {
    const type =
      el.tagName === "INPUT" ? (el.getAttribute("type") || "text").toLowerCase() : el.tagName.toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) return;
    elements.push({
      tag: el.tagName.toLowerCase(),
      type,
      label: computeLabel(el),
      name: el.getAttribute("name") || "",
      required: el.hasAttribute("required"),
      title: (el.getAttribute("title") || "").trim().slice(0, 120),
    });
  });

  return { links: Array.from(links), resourceHrefs: Array.from(resourceHrefs), elements };
}

function dedupeEdges(edges) {
  const seen = new Set();
  const result = [];
  for (const edge of edges) {
    const key = `${edge.from}=>${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(edge);
  }
  return result;
}

function describeElement(e) {
  const label = e.label ? `"${e.label}"` : "(no label)";
  return `${e.tag}${e.type ? `[${e.type}]` : ""} ${label} (${e.requirement}${e.required ? ", required" : ""})`;
}

function renderTestPlan(sm) {
  const lines = [];
  lines.push("# E2E Test Plan (generated)");
  lines.push("");
  lines.push(`Generated ${sm.generatedAt} by \`npm run explorer-agent\` against \`${sm.baseUrl}\`.`);
  lines.push("");
  lines.push(
    "This plan is derived from a read-only crawl (no clicks, no submits) of the app's own DOM. " +
      "It never automates the flagged actions below -- those need a human to design safe, " +
      "deterministic test data and fixtures first, per this repo's AGENTS.md testing rules."
  );
  lines.push("");

  if (sm.unreachedRoutes.length > 0) {
    lines.push("## Coverage gap");
    lines.push("");
    lines.push(
      "These known page routes were never reached by following links from the crawl's starting " +
        "point -- either they require data this run's fixture didn't have (e.g. no jobs in the " +
        "queue), or nothing in the UI currently links to them:"
    );
    lines.push("");
    for (const route of sm.unreachedRoutes) lines.push(`- \`${route}\``);
    lines.push("");
  }

  lines.push("## Per-route plan");
  lines.push("");
  for (const node of sm.nodes) {
    lines.push(`### \`${node.route}\``);
    lines.push("");
    if (node.error) {
      lines.push(`Navigation failed during the crawl: ${node.error}`);
      lines.push("");
      continue;
    }

    lines.push("**Suggested read-only E2E checks** (safe to automate):");
    lines.push("- Page loads without a client error and renders its primary content.");
    const safeElements = node.elements.filter((e) => !e.flagForReview);
    if (safeElements.length > 0) {
      lines.push("- The following controls are present and enabled:");
      for (const e of safeElements) lines.push(`  - ${describeElement(e)}`);
    }
    lines.push("");

    const flagged = node.elements.filter((e) => e.flagForReview);
    if (flagged.length > 0 || node.resourceActions.length > 0) {
      lines.push("**Manual review required before automating** (state-mutating and/or sensitive):");
      for (const e of flagged) lines.push(`- ${describeElement(e)} -- ${e.reviewReason}`);
      for (const action of node.resourceActions) {
        lines.push(`- resource action \`${action}\` -- triggers a server-side file/resource action`);
      }
      lines.push("");
    }
  }

  lines.push("## Manual-review queue (flat)");
  lines.push("");
  if (sm.manualReviewQueue.length === 0) {
    lines.push("None.");
  } else {
    for (const item of sm.manualReviewQueue) {
      lines.push(
        `- \`${item.route}\`: ${item.element.tag}${item.element.type ? `[${item.element.type}]` : ""} ` +
          `"${item.element.label ?? ""}" -- ${item.reason}`
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appDir = path.join(process.cwd(), "app");
  const pageTemplates = buildRouteTemplates(collectPageRoutes(appDir));
  const apiTemplates = buildRouteTemplates(collectApiRoutes(path.join(appDir, "api")));

  if (!(await checkReachable(args.baseUrl))) {
    console.error(
      `Cannot reach ${args.baseUrl}. This script never starts a dev server itself -- start one ` +
        `first (see docs/explorer-agent/README.md), ideally a disposable instance rather than one ` +
        `serving real personal data, then rerun.`
    );
    process.exitCode = 1;
    return;
  }

  const browser = await chromium.launch({ headless: args.headless });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  const visitedPatterns = new Map();
  const queue = ["/"];
  const queued = new Set(["/"]);
  const nodes = new Map();
  const edges = [];

  while (queue.length > 0 && visitedPatterns.size < args.maxPages) {
    const nextPath = queue.shift();
    const pattern = matchRoutePattern(nextPath, pageTemplates);
    if (visitedPatterns.has(pattern)) continue;
    visitedPatterns.set(pattern, nextPath);

    let data;
    try {
      await page.goto(new URL(nextPath, args.baseUrl).toString(), {
        waitUntil: "networkidle",
        timeout: 15000,
      });
      data = await page.evaluate(extractPageData);
    } catch (err) {
      nodes.set(pattern, {
        route: pattern,
        error: err instanceof Error ? err.message : String(err),
        elements: [],
        resourceActions: [],
      });
      continue;
    }

    const dedup = new Map();
    for (const raw of data.elements) {
      const key = elementDedupeKey(raw);
      if (!dedup.has(key)) dedup.set(key, classifyElement(raw));
    }
    const classified = Array.from(dedup.values());
    const resourceActions = Array.from(
      new Set(data.resourceHrefs.map((href) => matchRoutePattern(href, apiTemplates)))
    );

    nodes.set(pattern, {
      route: pattern,
      elements: classified,
      resourceActions,
      flags: {
        hasSensitiveInput: classified.some((e) => e.sensitive),
        hasComplexTransition: classified.some((e) => e.flagForReview) || resourceActions.length > 0,
      },
    });

    for (const link of data.links) {
      const linkPattern = matchRoutePattern(link, pageTemplates);
      edges.push({ from: pattern, to: linkPattern });
      if (!queued.has(link) && !visitedPatterns.has(linkPattern)) {
        queued.add(link);
        queue.push(link);
      }
    }
  }

  await browser.close();

  const crawledPatterns = new Set(nodes.keys());
  const unreachedRoutes = pageTemplates.map((t) => t.pattern).filter((p) => !crawledPatterns.has(p));

  const manualReviewQueue = [];
  for (const node of nodes.values()) {
    for (const el of node.elements) {
      if (el.flagForReview) {
        manualReviewQueue.push({
          route: node.route,
          element: { tag: el.tag, type: el.type, label: el.label },
          reason: el.reviewReason,
        });
      }
    }
    for (const action of node.resourceActions) {
      manualReviewQueue.push({
        route: node.route,
        element: { tag: "a", type: "resource-link", label: action },
        reason: "triggers a server-side file/resource action",
      });
    }
  }

  const stateMachine = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    pagesVisited: nodes.size,
    maxPages: args.maxPages,
    nodes: Array.from(nodes.values()),
    edges: dedupeEdges(edges),
    unreachedRoutes,
    manualReviewQueue,
  };

  fs.mkdirSync(args.outDir, { recursive: true });
  const jsonPath = path.join(args.outDir, "site-map.json");
  fs.writeFileSync(jsonPath, `${JSON.stringify(stateMachine, null, 2)}\n`);

  const planPath = path.join(args.outDir, "e2e-test-plan.md");
  fs.writeFileSync(planPath, renderTestPlan(stateMachine));

  console.log(`Crawled ${nodes.size} route(s) from ${args.baseUrl}.`);
  if (unreachedRoutes.length > 0) {
    console.log(`Unreached known routes: ${unreachedRoutes.join(", ")}`);
  }
  console.log(`Wrote ${jsonPath}`);
  console.log(`Wrote ${planPath}`);
}

main();
