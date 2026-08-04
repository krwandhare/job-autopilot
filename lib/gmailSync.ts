export type GmailSyncIssueCode = "thread_read" | "lead_import" | "mark_read";

const ISSUE_MESSAGES: Record<GmailSyncIssueCode, string> = {
  thread_read: "Could not read one alert email.",
  lead_import: "Could not import one job posting.",
  mark_read: "Imported jobs were saved, but one alert email could not be marked read.",
};

export function gmailSyncIssue(code: GmailSyncIssueCode): {
  code: GmailSyncIssueCode;
  message: string;
} {
  return { code, message: ISSUE_MESSAGES[code] };
}

export type GmailSyncSummary = {
  threadsChecked: number;
  threadsProcessed: number;
  imported: number;
  skipped: number;
  rateLimited: boolean;
  issues?: Array<{ code: GmailSyncIssueCode; message: string }>;
};

export function formatGmailSyncSummary(summary: GmailSyncSummary): string {
  const emailWord = summary.threadsChecked === 1 ? "email" : "emails";
  const parts = [
    `Imported ${summary.imported} lead(s).`,
    `${summary.threadsProcessed} of ${summary.threadsChecked} alert ${emailWord} fully processed.`,
  ];

  if (summary.skipped > 0) {
    parts.push(`${summary.skipped} posting(s) could not be imported.`);
  }
  if (summary.rateLimited) {
    parts.push("The run limit was reached; remaining alerts will stay unread for the next run.");
  }
  if (summary.issues?.some((issue) => issue.code === "thread_read")) {
    parts.push("At least one alert email could not be read.");
  }
  if (summary.issues?.some((issue) => issue.code === "mark_read")) {
    parts.push("At least one processed alert could not be marked read and may be checked again.");
  }

  return parts.join(" ");
}
