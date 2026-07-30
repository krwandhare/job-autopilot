// Curated keyword list used to detect skills with boundary-aware canonical
// names and aliases. Not exhaustive by design -- the user can add/remove
// skills manually in the Profile UI after extraction.
export const KNOWN_SKILLS = [
  // languages
  "JavaScript", "TypeScript", "Python", "Java", "C++", "C#", "Go", "Rust",
  "Ruby", "PHP", "Swift", "Kotlin", "Scala", "SQL", "R", "Bash", "Shell",
  // web/frontend
  "React", "Next.js", "Vue", "Angular", "Svelte", "HTML", "CSS", "Tailwind",
  "Redux", "GraphQL", "REST", "Webpack", "Vite",
  // backend/infra
  "Node.js", "Express", "Django", "Flask", "FastAPI", "Spring", "Rails",
  ".NET", "Docker", "Kubernetes", "Terraform", "AWS", "Azure", "GCP",
  "CI/CD", "Jenkins", "GitHub Actions", "Linux", "Nginx",
  // data
  "PostgreSQL", "MySQL", "MongoDB", "Redis", "Elasticsearch", "Kafka",
  "Spark", "Airflow", "Snowflake", "BigQuery", "dbt", "Pandas", "NumPy",
  "TensorFlow", "PyTorch", "Machine Learning", "Data Science", "NLP",
  // product/mgmt/general
  "Product Management", "Agile", "Scrum", "Project Management",
  "Leadership", "Communication", "Stakeholder Management", "Roadmap",
  "A/B Testing", "SQL Analytics", "Excel", "Tableau", "Power BI",
  "Figma", "UX Design", "UI Design", "Salesforce", "SEO", "Marketing",
  "Content Strategy", "Copywriting", "Sales", "Negotiation",
  "Customer Success", "Account Management", "Recruiting", "HR",
  "Financial Modeling", "Accounting", "Bookkeeping",
];

// Keep aliases conservative: an alias should be strong evidence that the
// canonical skill is actually mentioned, not merely a related concept.
export const SKILL_ALIASES: Record<string, string[]> = {
  JavaScript: ["ECMAScript"],
  "Node.js": ["NodeJS", "Node JS"],
  REST: ["RESTful", "REST API", "RESTful API"],
  "Next.js": ["NextJS", "Next JS"],
  Kubernetes: ["K8s"],
  "CI/CD": [
    "CICD",
    "continuous integration",
    "continuous delivery",
    "continuous deployment",
  ],
  PostgreSQL: ["Postgres"],
  MongoDB: ["Mongo DB"],
  GCP: ["Google Cloud", "Google Cloud Platform"],
  AWS: ["Amazon Web Services"],
  "GitHub Actions": ["Github CI"],
  Microservices: ["micro-services", "microservice architecture"],
  OCI: ["Oracle Cloud", "Oracle Cloud Infrastructure"],
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasBoundaryMatch(text: string, term: string): boolean {
  const pattern = new RegExp(
    `(?<![a-zA-Z0-9])${escapeRegExp(term)}(?![a-zA-Z0-9])`,
    "i"
  );
  return pattern.test(text);
}

export function skillAppearsInText(text: string, skill: string): boolean {
  const canonicalEntry = Object.entries(SKILL_ALIASES).find(
    ([canonical]) => canonical.toLowerCase() === skill.toLowerCase()
  );
  const terms = [skill, ...(canonicalEntry?.[1] ?? [])];
  return terms.some((term) => hasBoundaryMatch(text, term));
}

export function extractSkills(text: string, vocabulary: string[] = KNOWN_SKILLS): string[] {
  const found = new Set<string>();
  for (const skill of vocabulary) {
    if (skillAppearsInText(text, skill)) found.add(skill);
  }
  return Array.from(found);
}
