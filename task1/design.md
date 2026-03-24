# Task 1 — Scalable GitHub Data Aggregation System
## Design Document

---

## Objective

Design a system that aggregates repository data from 300+ GitHub repositories,
serves it to a website with minimal API usage, auto-updates on changes, and
scales cleanly to 10,000 repositories.

---

## Architecture Overview

The system is divided into five layers: ingestion, processing, storage, API, and
caching. Each layer is independently scalable.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          GitHub Platform                             │
│         REST API  ·  GraphQL API  ·  Webhooks  ·  Search API        │
└──────────────┬────────────────────────────┬────────────────────────┘
               │ REST / GraphQL              │ Push Events
               ▼                            ▼
┌──────────────────────┐      ┌─────────────────────────┐
│   Scheduled Sync     │      │   Webhook Receiver       │
│   (BullMQ + Cron)    │      │   (NestJS Controller)    │
└────────────┬─────────┘      └────────────┬────────────┘
             │                             │
             └──────────┬──────────────────┘
                        ▼
           ┌────────────────────────┐
           │    Processing Queue    │
           │  (BullMQ Workers)      │
           │  · Normalize data      │
           │  · Compute scores      │
           │  · Detect changes      │
           └────────────┬───────────┘
                        ▼
        ┌───────────────────────────────┐
        │         Storage Layer         │
        │  PostgreSQL ── Redis ── S3    │
        │  (persistent) (cache) (blobs) │
        └───────────────┬───────────────┘
                        ▼
           ┌────────────────────────┐
           │       API Layer        │
           │  NestJS REST + GraphQL │
           │  · ThrottlerGuard      │
           │  · ETag responses      │
           │  · Cache-Control hdr   │
           └────────────┬───────────┘
                        ▼
           ┌────────────────────────┐
           │      Frontend          │
           │  Angular 17+           │
           │  · HTTP interceptor    │
           │  · Service Worker      │
           └────────────────────────┘
```

---

## Core Components

### 1. Data Ingestion

Two ingestion paths run in parallel:

**Webhook-driven (primary):**
GitHub sends `push`, `pull_request`, `release`, `issues`, and `star` events to a
registered webhook endpoint. The receiver validates `X-Hub-Signature-256`, extracts
the repository identity, and enqueues a targeted refresh job. Only the changed
repository is re-fetched — not the entire collection.

**Scheduled sync (fallback):**
A BullMQ cron job runs every 6 hours and checks each tracked repository for staleness
using ETag conditional requests. If the ETag matches, GitHub returns `304 Not Modified`
and no data transfer occurs. If it differs, only that repository's data is fetched and
re-processed. This catches repos where webhooks are not registered or were missed.

### 2. Processing Layer

BullMQ workers consume jobs from the ingestion queue. Each job:
- Fetches only the fields that changed (incremental, not full re-fetch)
- Normalises the response into a consistent schema
- Computes derived fields (activity score, tech stack labels)
- Writes to PostgreSQL and invalidates the relevant Redis cache key

Workers are stateless — adding more worker instances scales throughput linearly.

### 3. Storage Layer

| Store | What is persisted | Why |
|---|---|---|
| PostgreSQL | Repo metadata, contributor stats, language breakdown, release history, computed scores | Durable, queryable, survives restarts |
| Redis | Hot endpoint responses, ETag values, rate limit counters, job deduplication keys | Sub-millisecond reads, TTL-based expiry |
| S3 / object storage | README blobs, AI summaries, large tree snapshots | Avoids storing large text in PostgreSQL rows |

**What is fetched dynamically (not stored):**
Real-time traffic data (`GET /repos/:owner/:repo/traffic/views`) — changes every hour
and is not cacheable for long. Fetched on-demand with a short 5-minute TTL.

### 4. API Layer

NestJS with REST and GraphQL endpoints. Responses include:
- `Cache-Control: public, max-age=300` on list endpoints
- `ETag` headers on all resource endpoints
- `Vary: Accept-Encoding` when GZIP is enabled

`ThrottlerModule` prevents abuse. An admin endpoint exposes cache flush and
manual refresh.

### 5. Caching Mechanism

Three-layer cache:

```
Request
  → L1: In-process memory (Map, TTL 60s)     — fastest, node-local
  → L2: Redis (shared, TTL 300s)              — shared across API nodes
  → L3: PostgreSQL                            — always fresh data
  → L4: GitHub API (conditional, ETag)        — only on cache miss
```

Conditional requests: every GitHub API call includes `If-None-Match: <etag>`. On
`304`, only the TTL is extended — no payload is transferred. On `200`, the new ETag
and payload replace the cache entry.

---

## Rate Limit Handling

GitHub allows 5,000 REST requests/hour and 5,000 GraphQL points/hour per token.

Strategies used:

1. **ETag conditional requests** — the single most effective strategy. A `304`
   response costs one API call but transfers zero bytes and resets nothing in the
   database.

2. **Webhook-first updates** — a push event means we re-fetch exactly one repo
   instead of polling all 300.

3. **GraphQL for multi-field fetches** — a single GraphQL query fetching
   `stars`, `forks`, `languages`, `releases`, and `openIssues` costs 1 request
   instead of 5 REST calls.

4. **Token pool** — for 10,000 repos, rotate across multiple GitHub tokens using a
   round-robin distributor. Each token's `X-RateLimit-Remaining` is tracked in Redis.
   Jobs are assigned to the token with the highest remaining quota.

5. **Backpressure in BullMQ** — if any token's remaining quota drops below 200,
   the worker pauses that token's queue and waits for the reset window
   (`X-RateLimit-Reset` header value).

6. **Search API for counts** — use `GET /search/issues?q=repo:org/repo+type:pr`
   with `total_count` to get PR/issue counts in one call instead of paginating
   through all items.

---

## Update Mechanism

```
Repo changes on GitHub
  → GitHub sends webhook event (< 1 second latency)
  → Receiver validates signature, extracts repo name
  → Enqueues targeted refresh job in BullMQ
  → Worker picks up job, fetches only changed fields
  → Writes to PostgreSQL, invalidates Redis key for that repo
  → Next API request serves fresh data from PostgreSQL
```

For repos without webhook access:
- 6-hour scheduled scan using ETag conditional checks
- If ETag matches → extend TTL, no data transfer
- If ETag differs → enqueue full refresh for that repo

For high-priority repos (pinned or featured): scheduled check every 30 minutes.

---

## Data Storage Strategy

**Stored persistently in PostgreSQL:**
- Repository: `id`, `name`, `owner`, `description`, `stars`, `forks`, `language`,
  `size`, `topics`, `created_at`, `pushed_at`, `default_branch`
- Languages: `repo_id`, `language`, `bytes`
- Contributors: `repo_id`, `username`, `contributions`
- Releases: `repo_id`, `tag_name`, `published_at`, `body_url`
- Computed: `activity_score`, `complexity_score`, `difficulty`, `tech_stack[]`

**Stored in S3 (large text):**
- README content (base64 decoded)
- AI-generated summaries
- Historical snapshots for trending computation

**Fetched dynamically (never stored):**
- Hourly traffic views/clones
- Real-time pull request diffs
- Individual commit file trees

---

## Scalability Plan — 300 to 10,000 Repositories

| Concern | 300 repos | 10,000 repos |
|---|---|---|
| API quota | 1 token, ~1 call/10 min per repo | Token pool of 5-10; GraphQL batching |
| Workers | 2 BullMQ workers | 20+ workers, horizontally scaled |
| Database | Single PostgreSQL | Read replicas; partition by org |
| Cache | Single Redis | Redis Cluster (sharded by repo key) |
| Webhook ingestion | Single NestJS instance | Queue behind API Gateway + fan-out |
| Scheduled sync | Single cron job | Distributed cron (BullMQ `repeat`) sharded by repo range |

The architecture is horizontally scalable at every layer because:
- Workers are stateless (state lives in PostgreSQL + Redis)
- API nodes are stateless (all cache is external)
- The queue (BullMQ) is the only shared mutable state, and Redis Cluster handles it

---

## Performance Optimization

- **HTTP response caching** — `Cache-Control: public, max-age=300` lets CDN and
  browsers cache list responses for 5 minutes without hitting the origin.
- **GZIP compression** — `compression()` middleware reduces JSON payload size by
  60-80% for contributor and project list responses.
- **GraphQL field selection** — resolvers for multi-source views return only
  the fields the client declares. No over-fetching.
- **Pagination at the database layer** — queries use `LIMIT` and `OFFSET` (or
  cursor-based `WHERE id > last_id`). No in-memory slicing.
- **Partial responses** — list endpoints return summary fields only. Full detail
  (languages, contributors, releases) is fetched on-demand per repo.

---

## Failure Handling

| Failure | Response |
|---|---|
| GitHub API rate limit exhausted | Serve stale data from PostgreSQL with `Stale-While-Revalidate` header; log alert; pause workers until reset window |
| GitHub API returns 5xx | Exponential backoff in BullMQ (3 retries: 5s, 30s, 5min); job moved to dead-letter queue after all retries |
| Repo not found / deleted | Mark repo as `archived: true` in PostgreSQL; stop scheduling refresh jobs; frontend shows archived badge |
| Redis unavailable | API falls through to PostgreSQL (L3); log alert; no user-visible failure |
| PostgreSQL unavailable | API returns last Redis-cached response if available; returns `503` with `Retry-After` header if not |
| Webhook delivery failure | GitHub retries webhooks for 72 hours; scheduled sync acts as safety net |
| Worker crash mid-job | BullMQ marks job as failed after timeout; re-queued automatically on next worker start |

---

## API Flow

See `api-flow.md` for the full sequence diagram.

Short summary: the frontend calls the NestJS API with `If-None-Match`. The API checks
Redis first. On a cache hit it returns `304` or the cached response. On a miss it
reads from PostgreSQL and responds while optionally triggering a background refresh if
the data is older than the staleness threshold.
