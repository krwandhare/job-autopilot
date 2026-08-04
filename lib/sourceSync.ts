const SOURCE_LABELS: Record<string, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  adzuna: "Adzuna",
};

export function sourceSyncFailure(sourceType: string): string {
  const label = SOURCE_LABELS[sourceType] ?? "job source";
  return `Could not sync one configured ${label} source. Check its configuration and try again.`;
}
