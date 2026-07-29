const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#?\w+);/g, (match, entity) => {
    if (entity in ENTITIES) return ENTITIES[entity];
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCharCode(parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCharCode(parseInt(entity.slice(1), 10));
    }
    return match;
  });
}

// Greenhouse (and some other ATSes) return HTML content that has itself been
// entity-encoded, e.g. "&lt;h2&gt;" instead of "<h2>". Decode first so the
// tag-stripping regex actually has real tags to strip.
export function stripHtml(raw: string): string {
  const decodedOnce = decodeEntities(raw);
  const withoutTags = decodedOnce.replace(/<[^>]*>/g, " ");
  return decodeEntities(withoutTags).replace(/\s+/g, " ").trim();
}
