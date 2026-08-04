import assert from "node:assert/strict";
import nextConfig from "../next.config.ts";

const externalPackages = nextConfig.serverExternalPackages ?? [];

assert.ok(
  externalPackages.includes("pdfjs-dist"),
  "pdfjs-dist must remain external so its PDF worker resolves from node_modules in Next.js development routes"
);

console.log("Resume server configuration checks passed.");
