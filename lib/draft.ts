import type { MatchResult } from "./matching";

export type JobInfo = {
  title: string;
  company: string;
};

export type DraftAnswer = { question: string; answer: string };

export type DraftResult = {
  coverLetter: string;
  answers: DraftAnswer[];
};

function firstSentences(text: string, count: number): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
  return sentences.slice(0, count).join(" ");
}

export function generateDraft(
  resumeText: string,
  job: JobInfo,
  match: MatchResult
): DraftResult {
  const highlight = firstSentences(resumeText, 2);
  const skillsList = match.matchedSkills.slice(0, 6);
  const skillsPhrase =
    skillsList.length > 0
      ? `including ${skillsList.join(", ")}`
      : "that align with the responsibilities described in the posting";

  const coverLetter = `Dear Hiring Team at ${job.company},

I'm writing to express my interest in the ${job.title} position. ${
    highlight || "My background aligns well with what you're looking for."
  }

Based on the job description, my experience ${skillsPhrase} maps directly onto what this role requires. I'd welcome the chance to discuss how I can contribute to your team.

Thank you for your time and consideration.

Best regards`;

  const answers: DraftAnswer[] = [
    {
      question: "Why are you interested in this role?",
      answer: `${job.title} at ${job.company} is a strong match for my background${
        skillsList.length > 0 ? ` in ${skillsList.slice(0, 3).join(", ")}` : ""
      }, and I'm looking to apply that experience in this next step.`,
    },
    {
      question: "Summarize your relevant experience.",
      answer: highlight || "See attached resume for detailed experience.",
    },
  ];

  return { coverLetter, answers };
}
