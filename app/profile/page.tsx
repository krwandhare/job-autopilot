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
      });

    fetch("/api/filters")
      .then((r) => r.json())
      .then((d) => {
        if (d.filter) {
          setFilter(d.filter);
          setLocationsText(d.filter.locations.join(", "));
          setExcludedCompaniesText(d.filter.excludedCompanies.join(", "));
        }
      });
  }, []);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);

    const form = new FormData();
    form.append("file", file);

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
    setUploading(false);
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
    setSkills(updated);
    if (!resume) return;
    await fetch("/api/resume", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: resume.id, skills: updated }),
    });
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

  async function saveEvidence(item: ResumeEvidence) {
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
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : "Could not save evidence");
    } finally {
      setSavingEvidenceId(null);
    }
  }

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
    await fetch("/api/filters", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSavedMessage("Filters saved.");
    setTimeout(() => setSavedMessage(null), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto p-8 space-y-10">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Profile</h1>
        <p className="text-sm text-gray-500">
          Upload your resume and set the filters that decide which jobs count as a match.
        </p>
      </div>

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

                <div className="space-y-3">
                  {evidence.map((item) => (
                    <article key={item.id} className="rounded border p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-gray-500">
                          <span className="font-medium text-gray-700">{item.section}</span>
                          {" · "}
                          {item.kind}
                          {item.sourceStartLine ? ` · source line ${item.sourceStartLine}` : ""}
                        </div>
                        <select
                          value={item.verificationStatus}
                          onChange={(event) =>
                            updateEvidence(item.id, {
                              verificationStatus: event.target
                                .value as ResumeEvidence["verificationStatus"],
                            })
                          }
                          className="border rounded px-2 py-1 text-xs"
                          suppressHydrationWarning
                        >
                          <option value="extracted">Needs review</option>
                          <option value="verified">Verified</option>
                          <option value="rejected">Reject</option>
                        </select>
                      </div>
                      <textarea
                        value={item.normalizedText}
                        onChange={(event) =>
                          updateEvidence(item.id, { normalizedText: event.target.value })
                        }
                        rows={2}
                        className="w-full rounded border px-2 py-1 text-sm"
                        suppressHydrationWarning
                      />
                      {item.sourceText !== item.normalizedText && (
                        <p className="text-xs text-gray-400">
                          Extracted source: {item.sourceText}
                        </p>
                      )}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => saveEvidence(item)}
                          disabled={savingEvidenceId === item.id || !item.normalizedText.trim()}
                          className="rounded bg-gray-900 px-3 py-1 text-xs text-white disabled:opacity-50"
                        >
                          {savingEvidenceId === item.id ? "Saving…" : "Save evidence"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Job filters</h2>
        <div className="grid grid-cols-2 gap-4">
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
          <label className="text-sm space-y-1 col-span-2">
            <span className="block text-gray-600">Excluded companies (comma-separated)</span>
            <input
              value={excludedCompaniesText}
              onChange={(e) => setExcludedCompaniesText(e.target.value)}
              placeholder="Acme Corp"
              className="border rounded px-2 py-1 w-full"
              suppressHydrationWarning
            />
          </label>
          <label className="text-sm flex items-center gap-2">
            <input
              type="checkbox"
              checked={filter.remoteOnly}
              onChange={(e) => setFilter({ ...filter, remoteOnly: e.target.checked })}
              suppressHydrationWarning
            />
            <span>Remote only</span>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={saveFilters}
            className="bg-gray-900 text-white text-sm px-4 py-2 rounded"
          >
            Save filters
          </button>
          {savedMessage && <span className="text-sm text-green-600">{savedMessage}</span>}
        </div>
      </section>
    </div>
  );
}
