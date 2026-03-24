# Pre-GSoC Selection Tasks — WebiU (c2siorg)

> Completed as part of the GSoC 2026 application for [c2siorg/Webiu](https://github.com/c2siorg/Webiu)
> Referenced issue: [#541](https://github.com/c2siorg/Webiu/issues/541)

**Repository:** [github.com/samarthsinh2660/pre-gsoc](https://github.com/samarthsinh2660/pre-gsoc)

---

## Task Overview

| Task | Type | Folder | Status |
|---|---|---|---|
| Task 1 — Design a Scalable GitHub Data Aggregation System | Architecture Design | [`task1/`](./task1/) | ✓ Complete |
| Task 2 — GitHub Repository Intelligence Analyzer | Development | [`task2/`](./task2/) | ✓ Complete |

---

## Task 1 — Design

**Objective:** Design an architecture for a system that efficiently aggregates repository
data from GitHub and serves it to a website while minimising API usage and ensuring
scalability.

**Scenario:** An organisation maintains 300+ GitHub repositories whose project
information must be displayed on a website. The system should automatically update
repository data when changes occur.

**Deliverables completed:**

- [`task1/design.md`](./task1/design.md) — 1–2 page design explanation covering all 9
  requirements: core components, rate limit handling, update mechanism, data storage
  strategy, scalability plan (300 → 10,000 repos), performance optimisation, failure
  handling, and API flow
- [`task1/architecture.md`](./task1/architecture.md) — Full system Mermaid diagram +
  cache hit flow + webhook update flow + scalability comparison table
- [`task1/api-flow.md`](./task1/api-flow.md) — Sequence diagrams: REST flow,
  GraphQL multi-source resolver, webhook → cache invalidation → frontend
- [`task1/tech-stack.md`](./task1/tech-stack.md) — Technology justification for every
  layer with alternatives considered and rejected

**Alignment with WebiU proposal:** Task 1 directly maps to Phase 2 of the GSoC
proposal (Serverless Architecture Evaluation) — the design covers the same
architectural decisions: ETag conditional caching, webhook-triggered updates,
Upstash Redis as a portable cache layer, BullMQ for job queues, and a scalability
path from the current NestJS monolith to a hybrid serverless + persistent architecture.

---

## Task 2 — Development

**Objective:** Build a tool that analyses multiple GitHub repositories and generates
insights about their activity, complexity, and learning difficulty.

**Live API:** `https://github-repo-analyzer.vercel.app/api/analyze`

**Deliverables completed:**

- Full TypeScript source (`src/types.ts`, `github.ts`, `scoring.ts`, `reporter.ts`,
  `analyzer.ts`) — CLI tool with parallel GitHub API fetches and rate-limit awareness
- Vercel serverless function (`api/analyze.ts`) — HTTP endpoint accepting
  `?repos=owner/repo1,owner/repo2`
- Sample outputs for 5 repositories with full score breakdowns
- Documentation: scoring formulas, assumptions, edge case handling, deployment guide

**Alignment with WebiU proposal:** Task 2 maps to Phase 3d–3e of the GSoC proposal
(AI summarisation + tech stack detection). The `detectTechStack()` function uses the
same rule-based language map + dependency file approach proposed for WebiU. The
activity and complexity scoring formulas directly inform the project analytics API
proposed in Phase 3b (`GET /api/v1/admin/analytics`).

---

## How the Tasks Connect to the Proposal

```
Pre-GSoC Task 1 (Design)
  └── Phase 2: Serverless evaluation
        ├── RemoteCacheService (Upstash Redis) — same cache portability design
        ├── Webhook-triggered AI pipeline — same webhook update mechanism
        └── Benchmark evaluation doc — same architectural spike approach

Pre-GSoC Task 2 (Development)
  └── Phase 3d: Tech stack detection
        ├── detectTechStack() — same rule-based language map approach
        └── Phase 3b: Admin analytics
              └── Activity/complexity counters inform cache hit rate + request volume metrics
```
