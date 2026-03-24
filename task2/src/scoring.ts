import {
  RawRepoData,
  LanguageBreakdown,
  ContributorSummary,
  ActivityData,
  DependencyFiles,
  Scores,
} from './types';

/**
 * ACTIVITY SCORE (0–100)
 *
 * Measures how alive and maintained the repository is based on recent events.
 *
 * Formula breakdown:
 *   commitScore    = min(30, commitsLast30d × 0.5)
 *                    → cap at 30 pts; 60 commits/month maxes this out
 *   issueScore     = min(15, issuesClosedLast30d × 0.75)
 *                    → cap at 15 pts; 20 closed issues/month maxes this out
 *   contribScore   = min(20, uniqueContributorsLast30d × 2)
 *                    → cap at 20 pts; 10 unique contributors maxes this out
 *   freshnessScore = max(0, 15 − daysSinceLastPush × 0.5)
 *                    → full 15 pts if pushed today; 0 pts if not pushed in 30+ days
 *   popularityScore = min(20, log10(stars + 1) × 5 + forks / 100)
 *                    → diminishing returns on stars; forks add a small bonus
 *
 * Total max = 30 + 15 + 20 + 15 + 20 = 100
 */
export function calculateActivityScore(
  raw: RawRepoData,
  activity: ActivityData,
): number {
  const commitScore = Math.min(30, activity.commitsLast30d * 0.5);
  const issueScore = Math.min(15, activity.issuesClosedLast30d * 0.75);
  const contribScore = Math.min(20, activity.uniqueContributorsLast30d * 2);
  const freshnessScore = Math.max(0, 15 - activity.daysSinceLastPush * 0.5);
  const popularityScore = Math.min(
    20,
    Math.log10(raw.stars + 1) * 5 + raw.forks / 100,
  );

  const total =
    commitScore + issueScore + contribScore + freshnessScore + popularityScore;

  return Math.round(Math.min(100, total));
}

/**
 * COMPLEXITY SCORE (0–100)
 *
 * Measures how large and structurally complex the repository is.
 * Higher complexity = harder to understand and contribute to.
 *
 * Formula breakdown:
 *   sizeScore       = min(30, sizeKB / 500)
 *                     → 15,000 KB (15 MB) repo maxes this at 30 pts
 *   langScore       = min(20, languageCount × 4)
 *                     → 5 languages maxes at 20 pts
 *   depScore        = sum of dependency file presence (max 12 pts)
 *                     → each dep file type = 2 pts
 *   issueBacklog    = min(15, openIssues / 20)
 *                     → 300 open issues maxes at 15 pts
 *   contribScale    = min(15, totalContributors / 5)
 *                     → 75+ contributors maxes at 15 pts
 *   ageScore        = min(8, ageYears × 1.5)
 *                     → 5+ year old repo maxes at 8 pts
 *
 * Total max = 30 + 20 + 12 + 15 + 15 + 8 = 100
 */
export function calculateComplexityScore(
  raw: RawRepoData,
  languages: LanguageBreakdown,
  contributors: ContributorSummary,
  deps: DependencyFiles,
): number {
  const languageCount = Object.keys(languages).length;

  const sizeScore = Math.min(30, raw.sizeKB / 500);

  const langScore = Math.min(20, languageCount * 4);

  const depScore =
    (deps.hasPackageJson ? 2 : 0) +
    (deps.hasRequirementsTxt ? 2 : 0) +
    (deps.hasPomXml ? 2 : 0) +
    (deps.hasGemfile ? 2 : 0) +
    (deps.hasGoMod ? 2 : 0) +
    (deps.hasCargo ? 2 : 0);

  const issueBacklog = Math.min(15, raw.openIssues / 20);

  const contribScale = Math.min(15, contributors.totalContributors / 5);

  const ageYears =
    (Date.now() - new Date(raw.createdAt).getTime()) /
    (1000 * 60 * 60 * 24 * 365);
  const ageScore = Math.min(8, ageYears * 1.5);

  const total =
    sizeScore + langScore + depScore + issueBacklog + contribScale + ageScore;

  return Math.round(Math.min(100, total));
}

/**
 * LEARNING DIFFICULTY CLASSIFICATION
 *
 * Combines activity and complexity to classify the repo for learners.
 *
 * Matrix:
 *   Beginner:     complexity < 28 AND activity < 40
 *                 → Small, quiet repos; easy to read through
 *   Advanced:     complexity >= 60 OR activity >= 75
 *                 → Large codebases or very active projects requiring
 *                   significant ramp-up time
 *   Intermediate: everything else
 *                 → Moderate size and activity; learnable with effort
 *
 * Rationale: a repo can be beginner-friendly even if it is somewhat active,
 * as long as the codebase itself is small. A highly active repo with a small
 * codebase is also Intermediate, not Beginner, because the review/contribution
 * pace is demanding.
 */
export function classifyDifficulty(
  activityScore: number,
  complexityScore: number,
): 'Beginner' | 'Intermediate' | 'Advanced' {
  if (complexityScore >= 60 || activityScore >= 75) return 'Advanced';
  if (complexityScore < 28 && activityScore < 40) return 'Beginner';
  return 'Intermediate';
}

/**
 * TECH STACK DETECTION
 *
 * Rule-based. No LLM. Uses language map + dependency files + topics.
 */
export function detectTechStack(
  languages: LanguageBreakdown,
  deps: DependencyFiles,
  topics: string[],
): string[] {
  const stack = new Set<string>();
  const langs = Object.keys(languages).map((l) => l.toLowerCase());

  if (langs.includes('typescript')) stack.add('TypeScript');
  if (langs.includes('javascript')) stack.add('JavaScript');
  if (langs.includes('python')) stack.add('Python');
  if (langs.includes('java')) stack.add('Java');
  if (langs.includes('go')) stack.add('Go');
  if (langs.includes('rust')) stack.add('Rust');
  if (langs.includes('ruby')) stack.add('Ruby');
  if (langs.includes('c++')) stack.add('C++');
  if (langs.includes('c')) stack.add('C');
  if (langs.includes('kotlin')) stack.add('Kotlin');
  if (langs.includes('dart')) stack.add('Dart');

  if (deps.hasPackageJson) stack.add('Node.js');
  if (deps.hasRequirementsTxt) stack.add('pip');
  if (deps.hasPomXml) stack.add('Maven');
  if (deps.hasGemfile) stack.add('Ruby/Bundler');
  if (deps.hasGoMod) stack.add('Go Modules');
  if (deps.hasCargo) stack.add('Cargo');

  // Topics often contain framework names
  const knownFrameworks = [
    'react', 'angular', 'vue', 'nestjs', 'express', 'django', 'flask',
    'spring', 'rails', 'nextjs', 'svelte', 'fastapi', 'graphql', 'docker',
    'kubernetes', 'terraform', 'ansible', 'webpack', 'vite', 'jest',
  ];
  for (const topic of topics) {
    if (knownFrameworks.includes(topic.toLowerCase())) {
      stack.add(topic.charAt(0).toUpperCase() + topic.slice(1));
    }
  }

  return Array.from(stack);
}

export function calculateScores(
  raw: RawRepoData,
  languages: LanguageBreakdown,
  contributors: ContributorSummary,
  activity: ActivityData,
  deps: DependencyFiles,
): Scores {
  const activityScore = calculateActivityScore(raw, activity);
  const complexityScore = calculateComplexityScore(raw, languages, contributors, deps);
  const difficulty = classifyDifficulty(activityScore, complexityScore);
  return { activityScore, complexityScore, difficulty };
}
