import assert from "node:assert/strict";
import { reconstructPositionedResumeText } from "../lib/resume.ts";

const item = (text, x, y, width = text.length * 5, height = 10) => ({
  text,
  x,
  y,
  width,
  height,
});

const text = reconstructPositionedResumeText([
  {
    pageNumber: 1,
    items: [
      item("Candidate Name", 50, 760),
      item("candidate@example.test", 50, 742),
      item("S U M M A R Y", 50, 700),
      item("Platform engineer focused on reliable", 50, 680),
      item("distributed systems.", 50, 668),
      item("S E L E C T E D  I M P A C T", 50, 630),
      item("99.99%", 50, 610, 35),
      item("uptime for regulated, high-", 90, 610, 120),
      item("scale apps.", 90, 598, 45),
      item("40%+", 226, 610, 28),
      item("throughput gain on cloud solutions", 260, 610, 140),
      item("60%", 401, 610, 25),
      item("faster deployments via", 430, 610, 95),
      item("microservices.", 430, 598, 60),
      item("CO R E S K I L LS", 50, 560),
      item("TypeScript, Kubernetes, Terraform", 50, 540),
    ],
  },
  {
    pageNumber: 2,
    items: [
      item("P R O F E S S I O N A L  E X P E R I E N C E", 50, 740),
      item("Example Corp", 50, 710, 60, 12),
      item("Senior Engineer", 115, 710, 80, 12),
      item("2020 - Present", 450, 710, 70),
      item("New York, NY", 50, 692),
      item("Improved high-", 64, 670),
      item("scale apps.", 64, 658),
      item("Reduced deployment time by 40%.", 64, 638),
      item("E D U C AT I O N", 50, 150),
      item("C E RT I F I C AT I O N S", 316, 150),
      item("Example University", 50, 130),
      item("Cloud Certification", 316, 130),
    ],
  },
]);

assert.match(text, /Candidate Name\ncandidate@example\.test/);
assert.match(
  text,
  /SUMMARY\nPlatform engineer focused on reliable distributed systems\./
);
assert.match(
  text,
  /SELECTED IMPACT\n99\.99% uptime for regulated, high-scale apps\.\n40%\+ throughput gain on cloud solutions\n60% faster deployments via microservices\./
);
assert.match(
  text,
  /PROFESSIONAL EXPERIENCE\nExample Corp Senior Engineer 2020 - Present\nNew York, NY\nImproved high-scale apps\.\nReduced deployment time by 40%\./
);
assert.match(text, /EDUCATION\nExample University/);
assert.match(text, /CERTIFICATIONS\nCloud Certification/);

console.log("Coordinate-aware resume layout reconstruction checks passed.");
