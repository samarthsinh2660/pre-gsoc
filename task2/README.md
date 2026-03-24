# GitHub Repository Intelligence Analyzer

> Analyse GitHub repositories and generate structured insights about activity, complexity, and learning difficulty.

Available as a **CLI tool** and a **deployed HTTP API**.

**Live API:** `https://github-repo-analyzer.vercel.app/api/analyze`

---

## Features

- **Activity Score (0–100)** — measures how alive and maintained a repo is (commits, issues, contributors, recency)
- **Complexity Score (0–100)** — measures codebase size, language diversity, dependency footprint, and age
- **Learning Difficulty** — classifies repos as `Beginner`, `Intermediate`, or `Advanced`
- **Tech Stack Detection** — rule-based, no LLM, derived from language map + dependency files + topics
- **Edge case safe** — missing data, empty repos, private repos, archived repos all handled gracefully
- **Rate limit aware** — tracks `X-RateLimit-Remaining`, warns when low, uses Search API for counts
- **Parallel fetches per repo** — languages, contributors, activity, deps all run in `Promise.all`

---

## Installation

**Requirements:** Node.js 20+, npm

```bash
# 1. Clone the repo
git clone https://github.com/samarthsinh2660/github-repo-analyzer.git
cd github-repo-analyzer

# 2. Install dependencies
npm install

# 3. Set your GitHub token (strongly recommended)
cp .env.example .env
# Open .env and set GITHUB_TOKEN=ghp_your_token_here
```

> Without a token the GitHub API allows only **60 requests/hour** (unauthenticated).
> With a token it allows **5,000 requests/hour**. You can analyse ~80 repos/hour with a token.
>
> Create a token at: **Settings → Developer settings → Personal access tokens → Fine-grained**
> Minimum permission: `Public Repositories (read-only)`

---

## Usage — CLI

```bash
# Single repo
npx ts-node src/analyzer.ts c2siorg/Webiu

# Multiple repos
npx ts-node src/analyzer.ts c2siorg/Webiu nestjs/nest webpack/webpack

# Full GitHub URLs also work
npx ts-node src/analyzer.ts https://github.com/expressjs/express

# With token inline (alternative to .env)
GITHUB_TOKEN=ghp_xxx npx ts-node src/analyzer.ts axios/axios
```

The tool prints a live progress log while running, then prints the full text report and saves a JSON report to `output/report-<timestamp>.json`.

**Example output:**

```
→ Analysing nestjs/nest ...
  ✓ Activity: 100  Complexity: 82  [Advanced]
→ Analysing expressjs/express ...
  ✓ Activity: 32   Complexity: 40  [Intermediate]

Total GitHub API requests used: 14

═══════════════════════════════════════════════════════
 GitHub Repository Intelligence Report
  Generated : 2026-03-25T10:00:00.000Z
  Repos     : 2 (2 ok, 0 failed)
═══════════════════════════════════════════════════════

▸ nestjs/nest  [ADVANCED]
  A progressive Node.js framework for building efficient, scalable server-side applications.

  Stars  68200  Forks  7640  Open Issues   312
  Size   18740 KB  Contributors  100  Languages 3

  Activity  [████████████████████] 100/100
  Complexity[████████████████    ]  82/100

  Commits (30d): 98   Issues closed (30d): 44
  Last push: 1 days ago   Unique contribs (30d): 18

  Tech stack: TypeScript, JavaScript, Node.js, NestJS, GraphQL

  ─────────────────────────────────────────────────

▸ expressjs/express  [INTERMEDIATE]
  Fast, unopinionated, minimalist web framework for node.

  Stars  65100  Forks 15800  Open Issues   178
  Size    1240 KB  Contributors  100  Languages 1

  Activity  [██████              ]  32/100
  Complexity[████████            ]  40/100

  Commits (30d): 6   Issues closed (30d): 4
  Last push: 35 days ago   Unique contribs (30d): 3

  Tech stack: JavaScript, Node.js
  Note: Express is in maintenance mode — low activity accurately reflects its stable state.

  ─────────────────────────────────────────────────

SUMMARY
  Beginner: 0  Intermediate: 1  Advanced: 1
  Most active : nestjs/nest
  Most complex: nestjs/nest
  Avg activity score  : 66
  Avg complexity score: 61
```

---

## Usage — HTTP API

The tool is deployed as a Vercel serverless function.

```bash
# JSON response (default)
curl "https://github-repo-analyzer.vercel.app/api/analyze?repos=c2siorg/Webiu,nestjs/nest"

# Plain text report
curl "https://github-repo-analyzer.vercel.app/api/analyze?repos=c2siorg/Webiu&format=text"

# Full GitHub URLs also accepted
curl "https://github-repo-analyzer.vercel.app/api/analyze?repos=https://github.com/webpack/webpack"
```

**Query parameters:**

| Parameter | Required | Default | Description |
|---|---|---|---|
| `repos` | Yes | — | Comma-separated `owner/repo` or full GitHub URLs. Max 10. |
| `format` | No | `json` | `json` or `text` |

**Error responses:**

```json
{ "error": "Missing required query parameter: repos",
  "example": "/api/analyze?repos=c2siorg/Webiu,nestjs/nest" }
```

```json
{ "error": "Maximum 10 repositories per request." }
```

---

## Scoring Formulas

### Activity Score (0–100)

Measures how alive and actively maintained the repository is, based on the last 30 days.

```
activityScore =
  min(30,  commitsLast30d × 0.5)             →  up to 30 pts  commit frequency
+ min(15,  issuesClosedLast30d × 0.75)       →  up to 15 pts  issue resolution pace
+ min(20,  uniqueContribsLast30d × 2)        →  up to 20 pts  contributor breadth
+ max(0,   15 − daysSinceLastPush × 0.5)     →  up to 15 pts  recency of last push
+ min(20,  log10(stars+1) × 5 + forks/100)  →  up to 20 pts  popularity signal
                                             ─────────────────────────
                                             max possible: 100
```

| Range | Meaning |
|---|---|
| 0–30 | Inactive / maintenance mode |
| 31–60 | Moderately active |
| 61–74 | Actively maintained |
| 75–100 | High-velocity project (major OSS) |

### Complexity Score (0–100)

Measures how large and structurally complex the codebase is — a proxy for onboarding difficulty.

```
complexityScore =
  min(30,  sizeKB / 500)            →  up to 30 pts  raw repo size
+ min(20,  languageCount × 4)       →  up to 20 pts  language diversity
+ Σ(depFile × 2)                    →  up to 12 pts  dependency ecosystem footprint
+ min(15,  openIssues / 20)         →  up to 15 pts  issue backlog depth
+ min(15,  totalContributors / 5)   →  up to 15 pts  contributor scale
+ min(8,   ageYears × 1.5)          →  up to  8 pts  historical depth
                                    ────────────────────────────────
                                    max possible: 100
```

**Dependency files checked** (2 pts each): `package.json`, `requirements.txt`, `pom.xml`, `Gemfile`, `go.mod`, `Cargo.toml`

| Range | Meaning |
|---|---|
| 0–27 | Small, focused codebase |
| 28–59 | Medium complexity |
| 60–100 | Large or architecturally complex |

### Learning Difficulty

```
Advanced      → complexityScore >= 60  OR  activityScore >= 75
Beginner      → complexityScore <  28  AND activityScore <  40
Intermediate  → everything else
```

**Why this matrix:** A beginner-friendly repo must be *both* small *and* quiet. A highly active repo demands significant context to contribute to even if the codebase itself is small — so high activity alone rules out Beginner. Advanced is triggered by either large codebase **or** very high activity, because both create significant onboarding cost independently.

---

## Live Results

All scores come from the real GitHub API — no cached or fake data. Try it:

```bash
curl "https://pre-gsoc.vercel.app/api/analyze?repos=c2siorg/Webiu,nestjs/nest,expressjs/express,axios/axios,webpack/webpack"
```

Or open the web UI at **https://pre-gsoc.vercel.app** and enter any repo.

---

## Edge Case Handling

| Scenario | How the tool handles it |
|---|---|
| Repo not found (404) | `error` field set in result; other repos still analysed |
| Private / no access (403) | Descriptive error; analysis continues for remaining repos |
| Empty repo (no commits) | `commitsLast30d = 0`; all scores calculated with zeros |
| Archived repo | Flagged via `isArchived: true`; activity near 0 — correctly low scores |
| Search API unavailable | Issue counts default to 0; analysis still completes |
| Rate limit low | Warning logged with reset time; analysis continues |
| Missing language data | `langScore = 0`; result still valid |

---

## Rate Limit Efficiency

**API calls per repo (approximate): 10–12 total**

| Call | Purpose | Efficient because |
|---|---|---|
| `GET /repos/{owner}/{repo}` | Stars, forks, size, language | Single call covers all basic fields |
| `GET /repos/{owner}/{repo}/languages` | Language breakdown | 1 call |
| `GET /repos/{owner}/{repo}/contributors` | Top contributors | 1 call, 100 per page |
| `GET /repos/{owner}/{repo}/commits?since=` | Recent commits count | 1 call, capped at 100 |
| `GET /search/issues?q=...type:issue state:closed` | Closed issue count | Uses `total_count` — no pagination |
| `GET /search/issues?q=...type:issue state:open created:>DATE` | Recently opened issues | Uses `total_count` |
| `GET /search/issues?q=...type:issue state:open` | Total open issues (no PRs) | Correct count — GitHub REST mixes PRs in |
| `GET /search/issues?q=...type:pr state:open` | Total open PRs | Separate from issues |
| `GET /repos/{owner}/{repo}/contents/{file}` × 6 | Dep file detection | All 6 run in `Promise.all` |

All per-repo fetches (languages, contributors, activity, deps) run in `Promise.all` — not sequentially. A 500ms pause between repos prevents burst rate-limit hits.

---

## Project Structure

```
.
├── src/
│   ├── types.ts        TypeScript interfaces for all data shapes
│   ├── github.ts       GitHub API client — rate-limit aware, error-safe
│   ├── scoring.ts      Activity + complexity formulas, difficulty classifier, tech stack
│   ├── reporter.ts     JSON report builder + ASCII text formatter
│   └── analyzer.ts     CLI entry point + repo orchestrator
├── api/
│   └── analyze.ts      Vercel serverless function (HTTP API)
├── public/
│   └── index.html      Web UI (dark GitHub-themed, fetches live API)
├── .env.example        Token configuration template
├── .gitignore
├── package.json
├── tsconfig.json
└── vercel.json         Serverless deployment config
```

---

## Deploying Your Own Instance

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy
vercel deploy --prod
```

Then in the Vercel dashboard → Project → Settings → Environment Variables, add:

```
GITHUB_TOKEN = ghp_your_token_here
```

Without a token, the API still works but is limited to 60 GitHub API requests/hour.

Vercel will print the deployment URL. The function is available at `<your-url>/api/analyze`.

---

## Assumptions and Limitations

- **Contributor count capped at 100** — GitHub's contributors endpoint returns a max of 100 per page. Repos with 500+ contributors all read as 100, affecting `contribScale`.
- **Commits capped at 100** — same limit. Very active repos (100+ commits/month) all return 100.
- **Dependency detection is shallow** — checks file presence at repo root only; does not parse file contents for actual dependency count.
- **Topics are self-reported** — tech stack labels from topics depend on repo owners tagging accurately.
- **No historical trending** — single point-in-time analysis only.
- **Unauthenticated limit** — without `GITHUB_TOKEN`, only 60 req/hr, which supports ~7 repos before exhaustion.
