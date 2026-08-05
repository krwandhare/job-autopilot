import assert from "node:assert/strict";
import fs from "node:fs";
import nextConfig from "../next.config.ts";

const externalPackages = nextConfig.serverExternalPackages ?? [];

assert.ok(
  externalPackages.includes("pdfjs-dist"),
  "pdfjs-dist must remain external so its PDF worker resolves from node_modules in Next.js development routes"
);

const layoutSource = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")
);

assert.doesNotMatch(
  layoutSource,
  /next\/font\/google/,
  "the root layout must not require a Google Fonts build-time request"
);
assert.match(layoutSource, /geist\/font\/sans/);
assert.match(layoutSource, /geist\/font\/mono/);
assert.equal(
  packageJson.dependencies?.geist,
  "^1.7.2",
  "the vendored Geist font package must remain a locked production dependency"
);

console.log("Resume server configuration checks passed.");
