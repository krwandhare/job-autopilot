# E2E Test Plan (generated)

Generated 2026-08-01T20:07:37.456Z by `npm run explorer-agent` against `http://localhost:3099`.

This plan is derived from a read-only crawl (no clicks, no submits) of the app's own DOM. It never automates the flagged actions below -- those need a human to design safe, deterministic test data and fixtures first, per this repo's AGENTS.md testing rules.

## Per-route plan

### `/`

**Suggested read-only E2E checks** (safe to automate):
- Page loads without a client error and renders its primary content.
- The following controls are present and enabled:
  - button[button] "Refresh actions" (action-button)
  - button[button] "0Verification" (action-button)
  - button[button] "0Needs review" (action-button)
  - button[button] "0External" (action-button)
  - button[button] "0Drafts" (action-button)
  - button[button] "0Decisions" (action-button)
  - button[button] "Add all known companies" (action-button)
  - button[button] "Add" (action-button)
  - input[text] "e.g. stripe" (text-input)
  - input[text] "e.g. netflix" (text-input)
  - input[text] "keywords (what)" (text-input)
  - input[text] "location (where)" (text-input)
  - input[text] "https://www.linkedin.com/jobs/view/..." (text-input)
  - input[checkbox] "Show non-matches (score 0)" (boolean-input)
  - select[select] (no label) (selection)

**Manual review required before automating** (state-mutating and/or sensitive):
- button[button] "Sync jobs" (action-button) -- label suggests a state-mutating action
- button[button] "Sync Gmail leads" (action-button) -- label suggests a state-mutating action
- button[button] "Import" (action-button) -- label suggests a state-mutating action

### `/profile`

**Suggested read-only E2E checks** (safe to automate):
- Page loads without a client error and renders its primary content.
- The following controls are present and enabled:
  - button[button] "Off" (action-button)
  - input[text] "Title must include (comma-separated)" (text-input)
  - input[text] "Title must exclude (comma-separated)" (text-input)
  - input[text] "Locations (comma-separated)" (text-input)
  - input[number] "Minimum salary (optional)" (text-input)
  - input[text] "Excluded companies (comma-separated)" (text-input)

**Manual review required before automating** (state-mutating and/or sensitive):
- button[button] "Save filters" (action-button) -- label suggests a state-mutating action
- input[file] (no label) (file-upload) -- handles an uploaded file -- treat as personal data

### `/autofill`

**Suggested read-only E2E checks** (safe to automate):
- Page loads without a client error and renders its primary content.
- The following controls are present and enabled:
  - button[button] "Show details" (action-button)
  - button[button] "Skip" (action-button)

**Manual review required before automating** (state-mutating and/or sensitive):
- button[button] "Fill" (action-button) -- label suggests a state-mutating action
- button[button] "Auto-submit" (action-button) -- label suggests a state-mutating action
- button[button] "Later" (action-button) -- label suggests a state-mutating action

### `/applications`

**Suggested read-only E2E checks** (safe to automate):
- Page loads without a client error and renders its primary content.
- The following controls are present and enabled:
  - button[button] "Company" (action-button)
  - button[button] "Domain" (action-button)
  - button[button] "Title" (action-button)
  - select[select] "Sort byApplication dateStatus" (selection)
  - input[checkbox] "No response in 14+ days" (boolean-input)

### `/jobs/[id]`

**Suggested read-only E2E checks** (safe to automate):
- Page loads without a client error and renders its primary content.
- The following controls are present and enabled:
  - select[select] (no label) (selection)

**Manual review required before automating** (state-mutating and/or sensitive):
- button[button] "Generate draft" (action-button) -- label suggests a state-mutating action

## Manual-review queue (flat)

- `/`: button[button] "Sync jobs" -- label suggests a state-mutating action
- `/`: button[button] "Sync Gmail leads" -- label suggests a state-mutating action
- `/`: button[button] "Import" -- label suggests a state-mutating action
- `/profile`: button[button] "Save filters" -- label suggests a state-mutating action
- `/profile`: input[file] "" -- handles an uploaded file -- treat as personal data
- `/autofill`: button[button] "Fill" -- label suggests a state-mutating action
- `/autofill`: button[button] "Auto-submit" -- label suggests a state-mutating action
- `/autofill`: button[button] "Later" -- label suggests a state-mutating action
- `/jobs/[id]`: button[button] "Generate draft" -- label suggests a state-mutating action
