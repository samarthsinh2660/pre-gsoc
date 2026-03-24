export interface RepoInput {
  owner: string;
  repo: string;
  url: string;
}

export interface RawRepoData {
  name: string;
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  watchers: number;
  language: string | null;
  sizeKB: number;
  createdAt: string;
  pushedAt: string;
  defaultBranch: string;
  topics: string[];
  isArchived: boolean;
  isFork: boolean;
}

export interface LanguageBreakdown {
  [language: string]: number; // bytes
}

export interface ContributorSummary {
  totalContributors: number;
  topContributors: Array<{ login: string; contributions: number }>;
}

export interface ActivityData {
  commitsLast30d: number;
  issuesClosedLast30d: number;
  issuesOpenedLast30d: number;
  daysSinceLastPush: number;
  uniqueContributorsLast30d: number;
  /** Total open issues excluding pull requests (via Search API) */
  openIssues: number;
  /** Total open pull requests */
  openPRs: number;
}

export interface DependencyFiles {
  hasPackageJson: boolean;
  hasRequirementsTxt: boolean;
  hasPomXml: boolean;
  hasGemfile: boolean;
  hasGoMod: boolean;
  hasCargo: boolean;
}

export interface Scores {
  activityScore: number;   // 0–100
  complexityScore: number; // 0–100
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
}

export interface AnalysisResult {
  repo: string;
  url: string;
  description: string | null;
  isArchived: boolean;
  isFork: boolean;
  raw: RawRepoData;
  languages: LanguageBreakdown;
  contributors: ContributorSummary;
  activity: ActivityData;
  dependencies: DependencyFiles;
  scores: Scores;
  techStack: string[];
  analysedAt: string;
  error?: string;
}

export interface Report {
  generatedAt: string;
  totalRepos: number;
  successful: number;
  failed: number;
  results: AnalysisResult[];
  summary: {
    byDifficulty: Record<string, number>;
    mostActive: string;
    mostComplex: string;
    averageActivityScore: number;
    averageComplexityScore: number;
  };
}
