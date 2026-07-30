"use client";

import { useEffect, useState } from "react";

type Resume = {
  id: number;
  filename: string;
  text: string;
  skills_json: string;
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
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  useEffect(() => {
    fetch("/api/resume")
      .then((r) => r.json())
      .then((d) => {
        if (d.resume) {
          setResume(d.resume);
          setSkills(JSON.parse(d.resume.skills_json));
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
    }
    setUploading(false);
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
            <p className="text-sm font-medium">{resume.filename}</p>
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
