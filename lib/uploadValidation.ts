// Shared upload guards for the two file-upload routes (POST /api/resume,
// POST /api/autofill/upload-file). `file.size` is metadata already parsed
// by formData() before any handler code runs, so checking it first avoids
// spending memory/CPU (buffering, PDF/DOCX parsing, disk writes) on an
// oversized file that will be rejected anyway.

export const MAX_RESUME_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_AUTOFILL_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB -- autofill

const RESUME_EXTENSIONS = new Set(["pdf", "docx", "txt"]);

// Autofill's file field can be pointed at almost any employer-required
// upload (resume, cover letter, portfolio, transcript, ...), so it can't use
// an allowlist the way the resume upload can -- instead it blocks
// executable/script extensions that have no legitimate reason to be
// attached to a job application form.
const DANGEROUS_AUTOFILL_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "cpl", "msi", "msp", "scr", "js", "jse",
  "vbs", "vbe", "wsf", "wsh", "ps1", "psm1", "sh", "bash", "zsh", "app",
  "dmg", "pkg", "deb", "rpm", "jar", "apk", "dll", "so", "dylib",
]);

function getExtension(filename: string): string {
  return filename.toLowerCase().split(".").pop() ?? "";
}

function formatMB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

// Returns a user-facing error string, or null if the file passes.
export function validateResumeUpload(file: File): string | null {
  if (file.size === 0) return "The uploaded file is empty.";
  if (file.size > MAX_RESUME_UPLOAD_BYTES) {
    return `Resume files must be ${formatMB(MAX_RESUME_UPLOAD_BYTES)} or smaller.`;
  }
  if (!RESUME_EXTENSIONS.has(getExtension(file.name))) {
    return "Unsupported resume file type. Use PDF, DOCX, or TXT.";
  }
  return null;
}

export function validateAutofillUpload(file: File): string | null {
  if (file.size === 0) return "The uploaded file is empty.";
  if (file.size > MAX_AUTOFILL_UPLOAD_BYTES) {
    return `Files must be ${formatMB(MAX_AUTOFILL_UPLOAD_BYTES)} or smaller.`;
  }
  if (DANGEROUS_AUTOFILL_EXTENSIONS.has(getExtension(file.name))) {
    return "This file type isn't allowed for upload.";
  }
  return null;
}
