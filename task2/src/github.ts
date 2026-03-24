import axios, { AxiosInstance } from 'axios';
import {
  RawRepoData,
  LanguageBreakdown,
  ContributorSummary,
  ActivityData,
  DependencyFiles,
} from './types';

const THIRTY_DAYS_AGO = (): string => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};

export class GitHubClient {
  private client: AxiosInstance;
  private requestCount = 0;

  constructor(token?: string) {
    this.client = axios.create({
      baseURL: 'https://api.github.com',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      timeout: 15_000,
    });

    // Track rate limit on every response
    this.client.interceptors.response.use((res) => {
      this.requestCount++;
      const remaining = res.headers['x-ratelimit-remaining'];
      if (remaining !== undefined && Number(remaining) < 50) {
        const reset = res.headers['x-ratelimit-reset'];
        const resetDate = new Date(Number(reset) * 1000).toISOString();
        console.warn(
          `[GitHubClient] Rate limit low: ${remaining} remaining. Resets at ${resetDate}`,
        );
      }
      return res;
    });
  }

  getRequestCount(): number {
    return this.requestCount;
  }

  async getRepo(owner: string, repo: string): Promise<RawRepoData> {
    const { data } = await this.client.get(`/repos/${owner}/${repo}`);
    return {
      name: data.name,
      fullName: data.full_name,
      description: data.description,
      stars: data.stargazers_count,
      forks: data.forks_count,
      openIssues: data.open_issues_count,
      watchers: data.watchers_count,
      language: data.language,
      sizeKB: data.size,
      createdAt: data.created_at,
      pushedAt: data.pushed_at,
      defaultBranch: data.default_branch,
      topics: data.topics ?? [],
      isArchived: data.archived,
      isFork: data.fork,
    };
  }

  async getLanguages(owner: string, repo: string): Promise<LanguageBreakdown> {
    try {
      const { data } = await this.client.get(`/repos/${owner}/${repo}/languages`);
      return data;
    } catch {
      return {};
    }
  }

  async getContributors(owner: string, repo: string): Promise<ContributorSummary> {
    try {
      // Fetch first page (up to 100) — enough for count + top contributors
      const { data } = await this.client.get(`/repos/${owner}/${repo}/contributors`, {
        params: { per_page: 100, anon: 0 },
      });

      if (!Array.isArray(data)) {
        return { totalContributors: 0, topContributors: [] };
      }

      return {
        totalContributors: data.length,
        topContributors: data.slice(0, 5).map((c: any) => ({
          login: c.login,
          contributions: c.contributions,
        })),
      };
    } catch {
      return { totalContributors: 0, topContributors: [] };
    }
  }

  async getActivityData(
    owner: string,
    repo: string,
    pushedAt: string,
  ): Promise<ActivityData> {
    const since = THIRTY_DAYS_AGO();
    const now = new Date();
    const lastPush = new Date(pushedAt);
    const daysSinceLastPush = Math.floor(
      (now.getTime() - lastPush.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Commits in last 30 days — fetch up to 100, count them
    let commitsLast30d = 0;
    let uniqueContributorsLast30d = 0;
    try {
      const { data: commits } = await this.client.get(
        `/repos/${owner}/${repo}/commits`,
        { params: { since, per_page: 100 } },
      );
      if (Array.isArray(commits)) {
        commitsLast30d = commits.length;
        const authors = new Set(
          commits
            .map((c: any) => c.author?.login)
            .filter(Boolean),
        );
        uniqueContributorsLast30d = authors.size;
      }
    } catch {
      // empty repo or no commits — handled gracefully
    }

    // Issues closed/opened in last 30 days + total open issues/PRs via Search API
    let issuesClosedLast30d = 0;
    let issuesOpenedLast30d = 0;
    let openIssues = 0;
    let openPRs = 0;
    try {
      const [closedRes, openedRes, openIssuesRes, openPRsRes] = await Promise.all([
        this.client.get('/search/issues', {
          params: {
            q: `repo:${owner}/${repo} type:issue state:closed closed:>${since.slice(0, 10)}`,
            per_page: 1,
          },
        }),
        this.client.get('/search/issues', {
          params: {
            q: `repo:${owner}/${repo} type:issue state:open created:>${since.slice(0, 10)}`,
            per_page: 1,
          },
        }),
        this.client.get('/search/issues', {
          params: {
            q: `repo:${owner}/${repo} type:issue state:open`,
            per_page: 1,
          },
        }),
        this.client.get('/search/issues', {
          params: {
            q: `repo:${owner}/${repo} type:pr state:open`,
            per_page: 1,
          },
        }),
      ]);
      issuesClosedLast30d = closedRes.data.total_count ?? 0;
      issuesOpenedLast30d = openedRes.data.total_count ?? 0;
      openIssues = openIssuesRes.data.total_count ?? 0;
      openPRs = openPRsRes.data.total_count ?? 0;
    } catch {
      // search API unavailable — leave at 0
    }

    return {
      commitsLast30d,
      issuesClosedLast30d,
      issuesOpenedLast30d,
      daysSinceLastPush,
      uniqueContributorsLast30d,
      openIssues,
      openPRs,
    };
  }

  async getDependencyFiles(
    owner: string,
    repo: string,
    branch: string,
  ): Promise<DependencyFiles> {
    const files = [
      'package.json',
      'requirements.txt',
      'pom.xml',
      'Gemfile',
      'go.mod',
      'Cargo.toml',
    ];

    const results = await Promise.allSettled(
      files.map((f) =>
        this.client.get(`/repos/${owner}/${repo}/contents/${f}`, {
          params: { ref: branch },
        }),
      ),
    );

    const exists = (i: number) => results[i].status === 'fulfilled';

    return {
      hasPackageJson: exists(0),
      hasRequirementsTxt: exists(1),
      hasPomXml: exists(2),
      hasGemfile: exists(3),
      hasGoMod: exists(4),
      hasCargo: exists(5),
    };
  }
}
