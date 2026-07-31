# Truthful per-job resume tailoring

Implementation status: completed on `feature/codex-work` through application
baseline `62fee11`. The five checkpoints and their focused validations are
recorded in `SESSION.md`.

## Outcome and limits

The feature will create an ATS-parseable, recruiter-readable resume variant
for one job while preserving the user's original resume and refusing to invent
qualifications. It can improve parsing and evidence-backed relevance; it
cannot guarantee ranking, an interview, or human review.

The first implementation is local and deterministic. Resume or job content is
not sent to an external model or service.

## Delivery tasks

1. **Structured evidence foundation**
   - Preserve each uploaded resume as an immutable source.
   - Derive line-addressable evidence records from the extracted text and
     detected skills.
   - Let the user verify, reject, or clarify extracted evidence.
   - Test extraction and persistence against a disposable SQLite database.
2. **Job requirement analysis**
   - Extract required and preferred qualifications, responsibilities,
     experience expectations, education/certifications, and role terminology.
   - Show evidence-backed coverage and genuine gaps without presenting a
     universal or probabilistic "ATS score."
   - Test negation, required/preferred classification, aliases, and
     deterministic ordering with synthetic postings.
3. **Tailoring and review**
   - Compose only from verified evidence.
   - Reorder relevant evidence, suggest context-supported terminology, and
     produce a concise summary and bullets without changing titles, dates, or
     facts.
   - Show every proposed change with its evidence source and rationale.
   - Require explicit approval; drafts are never eligible for autofill.
4. **ATS-safe export**
   - Produce simple, text-based DOCX and PDF variants with conventional
     headings and no columns, tables, text boxes, graphics, or critical
     header/footer content.
   - Reparse each artifact and compare required text before marking it valid.
   - Keep both formats available because ATS/provider guidance differs.
   - Preserve narrative source order; only the skills list may be reordered by
     requirement relevance.
5. **Autofill integration**
   - Attach the approved variant associated with the exact job.
   - Fall back to the master resume when no approved variant exists.
   - Never attach a draft, rejected, stale, or different job's variant.

## Invariants

- The uploaded master file and extracted source text are never rewritten.
- Every generated claim cites verified evidence from that master resume.
- Missing qualifications remain visible gaps; they are never inserted.
- Metrics, dates, employers, titles, education, certifications, and work
  authorization are never inferred.
- Keyword stuffing, hidden text, and misleading synonyms are prohibited.
- Variant approval is explicit, job-specific, reversible, and auditable.
- Local application status remains user-managed metadata, not employer proof.

## Validation

Each task receives focused deterministic tests using synthetic data and an
isolated temporary database. Every checkpoint also runs lint, strict
TypeScript, a production build, and diff checks. Export work adds round-trip
text extraction and visual inspection. Autofill work adds a disposable
two-job route/browser fixture and confirms master-resume fallback.
