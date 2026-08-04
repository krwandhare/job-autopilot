import assert from "node:assert/strict";
import JSZip from "jszip";
import {
  MAX_RESUME_UPLOAD_BYTES,
  validateResumeUploadContent,
  validateResumeUploadMetadata,
} from "../lib/resume.ts";

const validText = Buffer.from("Platform engineer with TypeScript experience.\n");
const validPdf = Buffer.from("%PDF-1.7\nsynthetic test fixture\n%%EOF\n");
const docx = new JSZip();
docx.file("[Content_Types].xml", "<Types />");
docx.file("word/document.xml", "<w:document />");
const validDocx = await docx.generateAsync({ type: "nodebuffer" });

assert.equal(
  validateResumeUploadMetadata({ name: "resume.pdf", size: validPdf.length, type: "application/pdf" }),
  "pdf"
);
assert.equal(
  validateResumeUploadMetadata({
    name: "resume.docx",
    size: validDocx.length,
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }),
  "docx"
);
assert.equal(
  validateResumeUploadMetadata({ name: "resume.txt", size: validText.length, type: "text/plain" }),
  "txt"
);

await validateResumeUploadContent(validPdf, "pdf");
await validateResumeUploadContent(validDocx, "docx");
await validateResumeUploadContent(validText, "txt");

assert.throws(
  () => validateResumeUploadMetadata({ name: "resume.exe", size: 4, type: "application/octet-stream" }),
  /Unsupported resume file type/
);
assert.throws(
  () => validateResumeUploadMetadata({ name: "resume.pdf", size: 0, type: "application/pdf" }),
  /empty/
);
assert.throws(
  () => validateResumeUploadMetadata({
    name: "resume.pdf",
    size: MAX_RESUME_UPLOAD_BYTES + 1,
    type: "application/pdf",
  }),
  /10MB or smaller/
);
assert.throws(
  () => validateResumeUploadMetadata({ name: "resume.pdf", size: 20, type: "text/plain" }),
  /content type does not match/
);
await assert.rejects(validateResumeUploadContent(Buffer.from("not a pdf"), "pdf"), /valid PDF/);
await assert.rejects(validateResumeUploadContent(Buffer.from("PK fake zip"), "docx"), /valid DOCX/);
await assert.rejects(validateResumeUploadContent(Buffer.from([0xff, 0xfe, 0x00]), "txt"), /UTF-8/);

console.log("Resume upload validation checks passed.");
