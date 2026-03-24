#!/usr/bin/env node
import * as fs from 'fs';
import * as path from 'path';
import { GitHubClient } from './github';
import { calculateScores, detectTechStack } from './scoring';
import { buildReport, formatTextReport } from './reporter';
import { AnalysisResult, RepoInput } from './types';

/**
 * Parse "owner/repo" or full GitHub URL into RepoInput.
 */
function parseRepoArg(arg: string): RepoInput {
  const cleaned = arg
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid repo: "${arg}". Expected "owner/repo" or GitHub URL.`);
  }
  const [owner, repo] = parts;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/**
 * Analyse a single repository. Returns a result with error field set if
 * anything fails — the caller should never throw.
 */
export async function analyseRepo(
  input: RepoInput,
  client: GitHubClient,
): Promise<AnalysisResult> {
  const fullName = `${input.owner}/${input.repo}`;

  try {
    // All independent fetches run in parallel where possible
    const raw = await client.getRepo(input.owner, input.repo);

    // These depend on raw data (branch, pushedAt) so run after
    const [languages, contributors, activity, deps, communityHealth] = await Promise.all([
      client.getLanguages(input.owner, input.repo),
      client.getContributors(input.owner, input.repo),
      client.getActivityData(input.owner, input.repo, raw.pushedAt),
      client.getDependencyFiles(input.owner, input.repo, raw.defaultBranch),
      client.getCommunityHealth(input.owner, input.repo),
    ]);

    const scores = calculateScores(raw, languages, contributors, activity, deps);
    const techStack = detectTechStack(languages, deps, raw.topics);

    return {
      repo: fullName,
      url: input.url,
      description: raw.description,
      isArchived: raw.isArchived,
      isFork: raw.isFork,
      raw,
      languages,
      contributors,
      activity,
      dependencies: deps,
      communityHealth,
      scores,
      techStack,
      analysedAt: new Date().toISOString(),
    };
  } catch (err: any) {
    const message =
      err?.response?.status === 404
        ? `Repository not found: ${fullName}`
        : err?.response?.status === 403
        ? `Access denied or rate limit exceeded for: ${fullName}`
        : err?.message ?? 'Unknown error';

    return {
      repo: fullName,
      url: input.url,
      description: null,
      isArchived: false,
      isFork: false,
      raw: {} as any,
      languages: {},
      contributors: { totalContributors: 0, totalContributions: 0, topContributors: [] },
      activity: {
        commitsLast30d: 0,
        issuesClosedLast30d: 0,
        issuesOpenedLast30d: 0,
        daysSinceLastPush: 0,
        uniqueContributorsLast30d: 0,
        openIssues: 0,
        openPRs: 0,
        goodFirstIssues: 0,
        mergedPRsLast30d: 0,
        closedPRsLast30d: 0,
      },
      communityHealth: { hasContributing: false, hasCodeOfConduct: false, hasIssueTemplate: false },
      dependencies: {
        hasPackageJson: false,
        hasRequirementsTxt: false,
        hasPomXml: false,
        hasGemfile: false,
        hasGoMod: false,
        hasCargo: false,
      },
      scores: { activityScore: 0, complexityScore: 0, difficulty: 'Beginner', busFactorPct: 0, prMergeRate: 0 },
      techStack: [],
      analysedAt: new Date().toISOString(),
      error: message,
    };
  }
}

/**
 * Analyse multiple repositories sequentially to avoid bursting rate limits.
 * Adds a 500ms pause between requests to be a good API citizen.
 */
export async function analyseRepos(
  inputs: RepoInput[],
  token?: string,
): Promise<ReturnType<typeof buildReport>> {
  const client = new GitHubClient(token);
  const results: AnalysisResult[] = [];

  for (const input of inputs) {
    console.log(`→ Analysing ${input.owner}/${input.repo} ...`);
    const result = await analyseRepo(input, client);
    results.push(result);

    if (result.error) {
      console.error(`  ✗ ${result.error}`);
    } else {
      console.log(
        `  ✓ Activity: ${result.scores.activityScore}  Complexity: ${result.scores.complexityScore}  [${result.scores.difficulty}]`,
      );
    }

    // Polite pause between repos
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`\nTotal GitHub API requests used: ${client.getRequestCount()}`);
  return buildReport(results);
}

// ─── CLI entry point ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(
      'Usage: npx ts-node src/analyzer.ts <repo1> [repo2] ...\n' +
      'Examples:\n' +
      '  npx ts-node src/analyzer.ts c2siorg/Webiu nestjs/nest\n' +
      '  npx ts-node src/analyzer.ts https://github.com/webpack/webpack\n\n' +
      'Set GITHUB_TOKEN env var for higher rate limits (5000 req/hr vs 60).',
    );
    process.exit(1);
  }

  let inputs: RepoInput[];
  try {
    inputs = args.map(parseRepoArg);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      'Warning: GITHUB_TOKEN not set. Using unauthenticated API (60 req/hr limit).',
    );
  }

  const report = await analyseRepos(inputs, token);

  // Write JSON report
  const outDir = path.join(process.cwd(), 'output');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `report-${Date.now()}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report saved to: ${jsonPath}`);

  // Print text report to stdout
  console.log('\n' + formatTextReport(report));
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
  });
}
