// Curated keyword list used to detect skills by simple substring/word-boundary
// matching in resume and job description text. Not exhaustive by design --
// the user can add/remove skills manually in the Profile UI after extraction.
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSkills(text: string, vocabulary: string[] = KNOWN_SKILLS): string[] {
  const found = new Set<string>();
  for (const skill of vocabulary) {
    const pattern = new RegExp(`(?<![a-zA-Z0-9])${escapeRegExp(skill)}(?![a-zA-Z0-9])`, "i");
    if (pattern.test(text)) found.add(skill);
  }
  return Array.from(found);
}
