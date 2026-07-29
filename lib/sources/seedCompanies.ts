// Curated list of company slugs verified against the live Greenhouse/Lever
// public APIs (each confirmed to return a non-empty job list as of the time
// this list was built). There is no public "search all companies" endpoint
// for either ATS -- this is the practical workaround: a maintained list that
// gets queried one company at a time, same as any per-company fetch. Add
// more slugs here as you discover them (find a company's careers page URL;
// if it redirects to job-boards.greenhouse.io/<slug> or jobs.lever.co/<slug>,
// that's the slug to add).
export const GREENHOUSE_SEED_SLUGS = [
  "stripe",
  "airbnb",
  "robinhood",
  "coinbase",
  "pinterest",
  "brex",
  "gusto",
  "figma",
  "discord",
  "asana",
  "dropbox",
  "gitlab",
  "cloudflare",
  "twilio",
  "databricks",
  "affirm",
  "instacart",
  "lyft",
  "mongodb",
  "elastic",
  "chime",
  "webflow",
  "vercel",
  "airtable",
  "calendly",
  "duolingo",
  "squarespace",
  "medium",
  "reddit",
  "twitch",
  "roblox",
  "samsara",
  "carta",
  "scaleai",
  "anthropic",
  "pagerduty",
  "datadog",
  "newrelic",
  "amplitude",
  "mixpanel",
  "intercom",
  "fivetran",
  "planetscale",
  "clickhouse",
  "warp",
];

export const LEVER_SEED_SLUGS = ["netflix", "palantir", "ro", "outreach", "clari", "plaid"];
