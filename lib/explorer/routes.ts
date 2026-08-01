// Pure route-template matching for the explorer-agent crawler. No filesystem
// or network access here -- callers discover the raw template strings (from
// `app/**/page.tsx` and `app/api/**/route.ts` folder names) and pass them in,
// which keeps this module trivially unit-testable.

export type RouteTemplate = {
  pattern: string;
  segments: string[];
};

function splitSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

export function buildRouteTemplates(patterns: string[]): RouteTemplate[] {
  return patterns.map((pattern) => ({ pattern, segments: splitSegments(pattern) }));
}

// Matches a concrete pathname (e.g. "/jobs/17") against the known templates
// (e.g. "/jobs/[id]") built from this app's actual folder structure. Falls
// back to "unmatched:<pathname>" for anything outside the known route table
// (e.g. a route added after the template list was built) rather than
// guessing -- an explicit miss is more useful in the report than a silent
// wrong match.
export function matchRoutePattern(pathname: string, templates: RouteTemplate[]): string {
  const segments = splitSegments(pathname);
  for (const template of templates) {
    if (template.segments.length !== segments.length) continue;
    const matches = template.segments.every(
      (templateSegment, i) => isDynamicSegment(templateSegment) || templateSegment === segments[i]
    );
    if (matches) return template.pattern;
  }
  return segments.length === 0 ? "/" : `unmatched:/${segments.join("/")}`;
}
