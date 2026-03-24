/**
 * Vercel Serverless Function — GitHub Repository Intelligence Analyzer
 *
 * GET /api/analyze?repos=owner/repo1,owner/repo2
 * GET /api/analyze?repos=https://github.com/nestjs/nest
 *
 * Deploy: vercel deploy
 * URL: https://github-repo-analyzer-<hash>.vercel.app/api/analyze
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { analyseRepos } from '../src/analyzer';
import { formatTextReport } from '../src/reporter';

function parseRepoArg(arg: string): { owner: string; repo: string; url: string } {
  const cleaned = arg
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) throw new Error(`Invalid repo: "${arg}"`);
  const [owner, repo] = parts;
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed. Use GET.' });
  }

  const reposParam = req.query.repos as string | undefined;
  const format = (req.query.format as string) ?? 'json';

  if (!reposParam) {
    return res.status(400).json({
      error: 'Missing required query parameter: repos',
      example: '/api/analyze?repos=c2siorg/Webiu,nestjs/nest',
    });
  }

  const repoArgs = reposParam.split(',').map((r) => r.trim()).filter(Boolean);

  if (repoArgs.length > 10) {
    return res.status(400).json({
      error: 'Maximum 10 repositories per request.',
    });
  }

  let inputs: { owner: string; repo: string; url: string }[];
  try {
    inputs = repoArgs.map(parseRepoArg);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const token = process.env.GITHUB_TOKEN;
    const report = await analyseRepos(inputs, token);

    if (format === 'text') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(formatTextReport(report));
    }

    return res.status(200).json(report);
  } catch (err: any) {
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  }
}
