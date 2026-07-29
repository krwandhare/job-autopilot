export type NormalizedJob = {
  source: string;
  sourceJobId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  salaryText: string | null;
  description: string | null;
  url: string;
  postedAt: string | null;
};
