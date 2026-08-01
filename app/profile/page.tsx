"use client";

import { useEffect, useState } from "react";

type Resume = {
  id: number;
  filename: string;
  text: string;
  skills_json: string;
};

type ResumeEvidence = {
  id: number;
  resumeId: number;
  kind: string;
  section: string;
  sourceText: string;
  normalizedText: string;
  sourceStartLine: number | null;
  verificationStatus: "extracted" | "verified" | "rejected";
};

type Filter = {
  id: number;
  titleInclude: string;
  titleExclude: string;
  locations: string[];
  remoteOnly: boolean;
  minSalary: number | null;
  requiredSkills: string[];
  excludedCompanies: string[];
};

// `dot`/`text` size the dense list row's compact status indicator; `selected`
// styles the equivalent choice in the edit sheet. Always paired with the
// `label` text, never color alone.
const EVIDENCE_STATUS_META: Record<
  ResumeEvidence["verificationStatus"],
  { label: string; dot: string; text: string; selected: string }
> = {
  verified: {
    label: "Verified",
    dot: "bg-green-600",
    text: "text-green-700",
    selected: "border-green-600 bg-green-50 text-green-800",
  },
  extracted: {
    label: "Review",
    dot: "bg-amber-500",
    text: "text-amber-700",
    selected: "border-amber-500 bg-amber-50 text-amber-800",
  },
  rejected: {
    label: "Rejected",
    dot: "bg-gray-400",
    text: "text-gray-500",
    selected: "border-gray-500 bg-gray-100 text-gray-700",
  },
};

export default function ProfilePage() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkill, setNewSkill] = useState("");
  const [uploading, setUploading] = useState(false);
  const [reprocessingResume, setReprocessingResume] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ResumeEvidence[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [savingEvidenceId, setSavingEvidenceId] = useState<number | null>(null);
  const [verifyingSkills, setVerifyingSkills] = useState(false);
  const [verifyingAllEvidence, setVerifyingAllEvidence] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState<string | null>(null);
  const [editingEvidenceId, setEditingEvidenceId] = useState<number | null>(null);
  const [evidenceSheetOpen, setEvidenceSheetOpen] = useState(false);

  const [filter, setFilter] = useState<Filter>({
    id: 0,
    titleInclude: "",
    titleExclude: "",
    locations: [],
    remoteOnly: false,
    minSalary: null,
    requiredSkills: [],
    excludedCompanies: [],
  });
  const [locationsText, setLocationsText] = useState("");
  const [excludedCompaniesText, setExcludedCompaniesText] = useState("");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [savingFilters, setSavingFilters] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [filtersError, setFiltersError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadEvidence(resumeId: number) {
    setEvidenceLoading(true);
    setEvidenceError(null);
    try {
      const res = await fetch("/api/resume/evidence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not build evidence profile");
      setEvidence(data.evidence ?? []);
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : "Could not build evidence profile");
    } finally {
      setEvidenceLoading(false);
    }
  }

  useEffect(() => {
    fetch("/api/resume")
      .then((r) => r.json())
      .then((d) => {
        if (d.resume) {
          setResume(d.resume);
          setSkills(JSON.parse(d.resume.skills_json));
          loadEvidence(d.resume.id);
        }
      })
      .catch((err) => setLoadError(`Could not load your resume: ${err instanceof Error ? err.message : String(err)}`));

    fetch("/api/filters")
      .then((r) => r.json())
      .then((d) => {
        if (d.filter) {
          setFilter(d.filter);
          setLocationsText(d.filter.locations.join(", "));
          setExcludedCompaniesText(d.filter.excludedCompanies.join(", "));
        }
      })
      .catch((err) => setLoadError(`Could not load your filters: ${err instanceof Error ? err.message : String(err)}`));
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        setUploadError(data.error ?? "Upload failed");
      } else {
        setResume({
          id: data.id,
          filename: data.filename,
          text: data.textPreview,
          skills_json: JSON.stringify(data.skills),
        });
        setSkills(data.skills);
        await loadEvidence(data.id);
      }
    } catch (err) {
      setUploadError(
        `Lost connection to the server (${
          err instanceof Error ? err.message : String(err)
        }). Check your network connection and try again.`
      );
    } finally {
      setUploading(false);
    }
  }

  async function reprocessPdfResume() {
    if (!resume || !resume.filename.toLowerCase().endsWith(".pdf")) return;
    if (
      !window.confirm(
        "Repair PDF columns and wrapped lines? This creates a new local resume revision, preserves the original file and old variants, and requires a new tailored draft."
      )
    ) {
      return;
    }

    setReprocessingResume(true);
    setUploadError(null);
    setEvidenceError(null);
    setEvidenceMessage(null);
    try {
      const res = await fetch("/api/resume/reprocess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeId: resume.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not repair PDF layout");
      setResume(data.resume);
      setSkills(JSON.parse(data.resume.skills_json));
      setEvidence(data.evidence ?? []);
      setEvidenceMessage(
        data.verificationCarriedForward
          ? "PDF layout repaired and existing verification carried forward. Create a new tailored draft for the job."
          : "PDF layout repaired. Review or verify the reconstructed evidence before creating a new tailored draft."
      );
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not repair PDF layout"
      );
    } finally {
      setReprocessingResume(false);
    }
  }

  async function saveSkills(updated: string[]) {
    const previous = skills;
    setSkills(updated);
    setSkillsError(null);
    if (!resume) return;
    try {
      const res = await fetch("/api/resume", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resume.id, skills: updated }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Could not save skills. Try again.");
      }
    } catch (err) {
      setSkills(previous);
      setSkillsError(
        err instanceof Error
          ? err.message
          : `Lost connection to the server (${String(err)}). Check your network connection and try again.`
      );
    }
  }

  function addSkill() {
    const trimmed = newSkill.trim();
    if (!trimmed || skills.includes(trimmed)) return;
    saveSkills([...skills, trimmed]);
    setNewSkill("");
  }

  function removeSkill(skill: string) {
    saveSkills(skills.filter((s) => s !== skill));
  }

  function updateEvidence(id: number, change: Partial<ResumeEvidence>) {
    setEvidence((items) =>
      items.map((item) => (item.id === id ? { ...item, ...change } : item))
    );
  }

  async function saveEvidence(item: ResumeEvidence): Promise<boolean> {
    setSavingEvidenceId(item.id);
    setEvidenceError(null);
    try {
      const res = await fetch("/api/resume/evidence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: item.id,
          normalizedText: item.normalizedText,
          verificationStatus: item.verificationStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save evidence");
      if (data.evidence) {
        updateEvidence(item.id, data.evidence);
      }
      return true;
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : "Could not save evidence");
      return false;
    } finally {
      setSavingEvidenceId(null);
    }
  }

  function openEvidenceModal(id: number) {
    setEvidenceError(null);
    setEditingEvidenceId(id);
  }

  function closeEvidenceModal() {
    setEvidenceSheetOpen(false);
    window.setTimeout(() => setEditingEvidenceId(null), 200);
  }

  // Slide the sheet in a tick after mount (so the closed transform paints
  // first), lock body scroll while it's open, and close on Escape.
  useEffect(() => {
    if (editingEvidenceId === null) return;
    const raf = requestAnimationFrame(() => setEvidenceSheetOpen(true));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEvidenceSheetOpen(false);
        window.setTimeout(() => setEditingEvidenceId(null), 200);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editingEvidenceId]);

  const editingEvidence = evidence.find((item) => item.id === editingEvidenceId) ?? null;

  async function verifyAllPendingSkills() {
    if (!resume) return;
    const pendingSkills = evidence.filter(
      (item) => item.kind === "skill" && item.verificationStatus === "extracted"
    );
    if (pendingSkills.length === 0) return;
    if (
      !window.confirm(
        `Verify all ${pendingSkills.length} skills awaiting review? Rejected skills will stay rejected.`
      )
    ) {
      return;
    }

    setVerifyingSkills(true);
    setEvidenceError(null);
    setEvidenceMessage(null);
    try {
      const res = await fetch("/api/resume/evidence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_all_skills",
          resumeId: resume.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not verify skills");
      setEvidence(data.evidence ?? []);
      setEvidenceMessage(
        `${data.updatedCount ?? pendingSkills.length} skills verified. Refresh existing job analyses or tailored drafts to use them.`
      );
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : "Could not verify skills");
    } finally {
      setVerifyingSkills(false);
    }
  }

  async function verifyAllPendingEvidence() {
    if (!resume) return;
    const pendingEvidence = evidence.filter(
      (item) => item.verificationStatus === "extracted"
    );
    if (pendingEvidence.length === 0) return;
    if (
      !window.confirm(
        `Verify all ${pendingEvidence.length} remaining resume items? This treats the unreviewed content in your uploaded resume as accurate. Rejected items will stay rejected.`
      )
    ) {
      return;
    }

    setVerifyingAllEvidence(true);
    setEvidenceError(null);
    setEvidenceMessage(null);
    try {
      const res = await fetch("/api/resume/evidence", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "verify_all_evidence",
          resumeId: resume.id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not verify resume content");
      setEvidence(data.evidence ?? []);
      setEvidenceMessage(
        `${data.updatedCount ?? pendingEvidence.length} resume items verified. Create a new tailored draft to include them.`
      );
    } catch (error) {
      setEvidenceError(
        error instanceof Error ? error.message : "Could not verify resume content"
      );
    } finally {
      setVerifyingAllEvidence(false);
    }
  }

  async function saveFilters() {
    setFiltersError(null);
    setSavingFilters(true);
    const payload = {
      ...filter,
      locations: locationsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      excludedCompanies: excludedCompaniesText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    try {
      const res = await fetch("/api/filters", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(data.error ?? "Could not save filters. Try again.");
      }
      setSavedMessage("Filters saved.");
      setTimeout(() => setSavedMessage(null), 2000);
    } catch (err) {
      setFiltersError(
        err instanceof Error
          ? err.message
          : `Lost connection to the server (${String(err)}). Check your network connection and try again.`
      );
    } finally {
      setSavingFilters(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Profile</h1>
        <p className="text-sm text-gray-500">
          Upload your resume and set the filters that decide which jobs count as a match.
        </p>
      </div>

      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Resume</h2>
        <input
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={handleUpload}
          disabled={uploading}
          className="block text-sm"
          suppressHydrationWarning
        />
        {uploading && <p className="text-sm text-gray-500">Parsing resume…</p>}
        {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}

        {resume && (
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{resume.filename}</p>
              {resume.filename.toLowerCase().endsWith(".pdf") && (
                <button
                  type="button"
                  onClick={reprocessPdfResume}
                  disabled={reprocessingResume || uploading}
                  className="rounded border border-blue-700 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                >
                  {reprocessingResume
                    ? "Repairing PDF layout…"
                    : "Repair PDF line breaks"}
                </button>
              )}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Detected skills (edit as needed — these drive job matching):
              </p>
              {skillsError && <p className="text-xs text-red-600 mb-2">{skillsError}</p>}
              <div className="flex flex-wrap gap-2 mb-2">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 text-xs px-2 py-1 rounded-full"
                  >
                    {s}
                    <button
                      onClick={() => removeSkill(s)}
                      className="text-blue-400 hover:text-blue-700"
                      aria-label={`Remove ${s}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addSkill()}
                  placeholder="Add a skill"
                  className="border rounded px-2 py-1 text-sm flex-1"
                  suppressHydrationWarning
                />
                <button
                  onClick={addSkill}
                  className="bg-gray-900 text-white text-sm px-3 py-1 rounded"
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        )}

        {resume && (
          <div className="border rounded-lg p-4 space-y-4">
            <div>
              <h3 className="text-sm font-semibold">Verified career evidence</h3>
              <p className="text-xs text-gray-500 mt-1">
                Tailored resumes will use only facts you mark verified. Edit unclear extraction,
                reject incorrect items, and keep the uploaded master resume unchanged.
              </p>
            </div>

            {evidenceLoading && (
              <p className="text-sm text-gray-500">Building evidence profile…</p>
            )}
            {evidenceError && <p className="text-sm text-red-600">{evidenceError}</p>}
            {evidenceMessage && <p className="text-sm text-green-700">{evidenceMessage}</p>}
            {!evidenceLoading && evidence.length === 0 && !evidenceError && (
              <p className="text-sm text-gray-500">
                No evidence was extracted. The master resume remains available.
              </p>
            )}

            {evidence.length > 0 && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="text-green-700">
                      {evidence.filter((item) => item.verificationStatus === "verified").length}{" "}
                      verified
                    </span>
                    <span className="text-amber-700">
                      {evidence.filter((item) => item.verificationStatus === "extracted").length}{" "}
                      awaiting review
                    </span>
                    <span className="text-gray-500">
                      {evidence.filter((item) => item.verificationStatus === "rejected").length}{" "}
                      rejected
                    </span>
                  </div>
                  {evidence.some(
                    (item) =>
                      item.kind === "skill" && item.verificationStatus === "extracted"
                  ) && (
                    <button
                      type="button"
                      onClick={verifyAllPendingSkills}
                      disabled={verifyingSkills || savingEvidenceId !== null}
                      className="rounded border border-green-700 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                    >
                      {verifyingSkills ? "Verifying skills…" : "Verify all skills"}
                    </button>
                  )}
                </div>

                {evidence.some((item) => item.verificationStatus === "extracted") && (
                  <div className="rounded border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs text-blue-900">
                      Trust all remaining content in this uploaded resume? This is faster, but you
                      remain responsible for every claim.
                    </p>
                    <button
                      type="button"
                      onClick={verifyAllPendingEvidence}
                      disabled={
                        verifyingAllEvidence ||
                        verifyingSkills ||
                        savingEvidenceId !== null
                      }
                      className="mt-2 rounded bg-blue-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {verifyingAllEvidence
                        ? "Verifying resume content…"
                        : "Verify all resume content"}
                    </button>
                  </div>
                )}

                <div className="divide-y overflow-hidden rounded-lg border" role="list">
                  {evidence.map((item) => {
                    const meta = EVIDENCE_STATUS_META[item.verificationStatus];
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="listitem"
                        onClick={() => openEvidenceModal(item.id)}
                        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 active:bg-gray-100"
                      >
                        <span className="w-20 shrink-0 truncate text-xs font-semibold capitalize text-gray-500">
                          {item.kind}
                        </span>
                        <span
                          className={`min-w-0 flex-1 truncate text-sm ${
                            item.verificationStatus === "rejected"
                              ? "text-gray-400 line-through"
                              : "text-gray-800"
                          }`}
                        >
                          {item.normalizedText.trim() || "(empty)"}
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${meta.text}`}
                        >
                          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {editingEvidence && (
        <div className="fixed inset-0 z-50" role="presentation">
          <div
            className={`absolute inset-0 bg-gray-950/40 transition-opacity duration-200 ${
              evidenceSheetOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={closeEvidenceModal}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="evidence-modal-heading"
            className={`absolute inset-x-0 bottom-0 mx-auto w-full max-w-lg rounded-t-2xl bg-white p-4 shadow-xl transition-transform duration-200 ${
              evidenceSheetOpen ? "translate-y-0" : "translate-y-full"
            }`}
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-gray-200" aria-hidden="true" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p id="evidence-modal-heading" className="text-sm font-semibold capitalize text-gray-950">
                  {editingEvidence.kind}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {editingEvidence.section}
                  {editingEvidence.sourceStartLine
                    ? ` · source line ${editingEvidence.sourceStartLine}`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEvidenceModal}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-5 w-5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 5l10 10M15 5L5 15" />
                </svg>
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              {(["extracted", "verified", "rejected"] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => updateEvidence(editingEvidence.id, { verificationStatus: status })}
                  aria-pressed={editingEvidence.verificationStatus === status}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm font-medium ${
                    editingEvidence.verificationStatus === status
                      ? EVIDENCE_STATUS_META[status].selected
                      : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {EVIDENCE_STATUS_META[status].label}
                </button>
              ))}
            </div>

            <textarea
              value={editingEvidence.normalizedText}
              onChange={(event) =>
                updateEvidence(editingEvidence.id, { normalizedText: event.target.value })
              }
              rows={4}
              autoFocus
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
            />

            {editingEvidence.sourceText !== editingEvidence.normalizedText && (
              <p className="mt-2 text-xs text-gray-400">
                Extracted source: {editingEvidence.sourceText}
              </p>
            )}

            {evidenceError && <p className="mt-2 text-xs text-red-600">{evidenceError}</p>}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeEvidenceModal}
                className="rounded-lg border border-gray-300 px-3.5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const ok = await saveEvidence(editingEvidence);
                  if (ok) closeEvidenceModal();
                }}
                disabled={
                  savingEvidenceId === editingEvidence.id || !editingEvidence.normalizedText.trim()
                }
                className="rounded-lg bg-gray-900 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {savingEvidenceId === editingEvidence.id ? "Saving…" : "Save evidence"}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Job filters</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          <label className="text-sm space-y-1">
            <span className="block text-gray-600">Title must include (comma-separated)</span>
            <input
              value={filter.titleInclude}
              onChange={(e) => setFilter({ ...filter, titleInclude: e.target.value })}
              placeholder="engineer, developer"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-600">Title must exclude (comma-separated)</span>
            <input
              value={filter.titleExclude}
              onChange={(e) => setFilter({ ...filter, titleExclude: e.target.value })}
              placeholder="intern, senior"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-600">Locations (comma-separated)</span>
            <input
              value={locationsText}
              onChange={(e) => setLocationsText(e.target.value)}
              placeholder="Remote, New York"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-600">Minimum salary (optional)</span>
            <input
              type="number"
              value={filter.minSalary ?? ""}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  minSalary: e.target.value ? Number(e.target.value) : null,
                })
              }
              placeholder="100000"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <label className="text-sm space-y-1">
            <span className="block text-gray-600">Excluded companies (comma-separated)</span>
            <input
              value={excludedCompaniesText}
              onChange={(e) => setExcludedCompaniesText(e.target.value)}
              placeholder="Acme Corp"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <div className="text-sm space-y-1">
            <span className="block text-gray-600">Remote only</span>
            <button
              type="button"
              role="switch"
              aria-checked={filter.remoteOnly}
              onClick={() => setFilter({ ...filter, remoteOnly: !filter.remoteOnly })}
              className="flex h-[30px] items-center gap-2"
            >
              <span
                aria-hidden="true"
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  filter.remoteOnly ? "bg-gray-900" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    filter.remoteOnly ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </span>
              <span className="text-gray-700">{filter.remoteOnly ? "On" : "Off"}</span>
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveFilters}
            disabled={savingFilters}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
          >
            {savingFilters ? "Saving…" : "Save filters"}
          </button>
          {savedMessage && <span className="text-sm text-green-600">{savedMessage}</span>}
        </div>
        {filtersError && <p className="text-sm text-red-600">{filtersError}</p>}
      </section>
    </div>
  );
}
