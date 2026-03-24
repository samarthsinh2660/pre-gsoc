import { AnalysisResult, Report } from './types';

export function buildReport(results: AnalysisResult[]): Report {
  const successful = results.filter((r) => !r.error);
  const failed = results.filter((r) => !!r.error);

  const byDifficulty: Record<string, number> = {
    Beginner: 0,
    Intermediate: 0,
    Advanced: 0,
  };

  let totalActivity = 0;
  let totalComplexity = 0;
  let mostActive = successful[0]?.repo ?? '';
  let mostComplex = successful[0]?.repo ?? '';
  let maxActivity = -1;
  let maxComplexity = -1;

  for (const r of successful) {
    byDifficulty[r.scores.difficulty]++;
    totalActivity += r.scores.activityScore;
    totalComplexity += r.scores.complexityScore;

    if (r.scores.activityScore > maxActivity) {
      maxActivity = r.scores.activityScore;
      mostActive = r.repo;
    }
    if (r.scores.complexityScore > maxComplexity) {
      maxComplexity = r.scores.complexityScore;
      mostComplex = r.repo;
    }
  }

  const n = successful.length || 1;

  return {
    generatedAt: new Date().toISOString(),
    totalRepos: results.length,
    successful: successful.length,
    failed: failed.length,
    results,
    summary: {
      byDifficulty,
      mostActive,
      mostComplex,
      averageActivityScore: Math.round(totalActivity / n),
      averageComplexityScore: Math.round(totalComplexity / n),
    },
  };
}

export function formatTextReport(report: Report): string {
  const lines: string[] = [];

  lines.push('═══════════════════════════════════════════════════════');
  lines.push(' GitHub Repository Intelligence Report');
  lines.push(`  Generated : ${report.generatedAt}`);
  lines.push(`  Repos     : ${report.totalRepos} (${report.successful} ok, ${report.failed} failed)`);
  lines.push('═══════════════════════════════════════════════════════');
  lines.push('');

  for (const r of report.results) {
    if (r.error) {
      lines.push(`✗ ${r.repo}`);
      lines.push(`  Error: ${r.error}`);
      lines.push('');
      continue;
    }

    const bar = (score: number) => '█'.repeat(Math.round(score / 5)) + '░'.repeat(20 - Math.round(score / 5));

    lines.push(`▸ ${r.repo}  [${r.scores.difficulty.toUpperCase()}]`);
    lines.push(`  ${r.description ?? '(no description)'}`);
    lines.push('');
    lines.push(`  Stars ${String(r.raw.stars).padStart(6)}  Forks ${String(r.raw.forks).padStart(5)}  Open Issues ${String(r.raw.openIssues).padStart(5)}`);
    lines.push(`  Size  ${String(r.raw.sizeKB).padStart(6)} KB  Contributors ${String(r.contributors.totalContributors).padStart(4)}  Languages ${Object.keys(r.languages).length}`);
    lines.push('');
    lines.push(`  Activity  [${bar(r.scores.activityScore)}] ${String(r.scores.activityScore).padStart(3)}/100`);
    lines.push(`  Complexity[${bar(r.scores.complexityScore)}] ${String(r.scores.complexityScore).padStart(3)}/100`);
    lines.push('');
    lines.push(`  Commits (30d): ${r.activity.commitsLast30d}   Issues closed (30d): ${r.activity.issuesClosedLast30d}`);
    lines.push(`  Last push: ${r.activity.daysSinceLastPush} days ago   Unique contribs (30d): ${r.activity.uniqueContributorsLast30d}`);
    lines.push('');
    lines.push(`  Tech stack: ${r.techStack.join(', ') || 'unknown'}`);
    if (r.contributors.topContributors.length) {
      lines.push(`  Top contributors: ${r.contributors.topContributors.map((c) => `${c.login}(${c.contributions})`).join(', ')}`);
    }
    lines.push('');
    lines.push('  ─────────────────────────────────────────────────');
    lines.push('');
  }

  lines.push('SUMMARY');
  lines.push(`  Beginner: ${report.summary.byDifficulty.Beginner}  Intermediate: ${report.summary.byDifficulty.Intermediate}  Advanced: ${report.summary.byDifficulty.Advanced}`);
  lines.push(`  Most active : ${report.summary.mostActive}`);
  lines.push(`  Most complex: ${report.summary.mostComplex}`);
  lines.push(`  Avg activity score  : ${report.summary.averageActivityScore}`);
  lines.push(`  Avg complexity score: ${report.summary.averageComplexityScore}`);
  lines.push('');

  return lines.join('\n');
}
