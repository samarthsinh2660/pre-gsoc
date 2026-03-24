# Task 1 — Design a Scalable GitHub Data Aggregation System

> Pre-GSoC selection task for [c2siorg/Webiu](https://github.com/c2siorg/Webiu) — issue [#541](https://github.com/c2siorg/Webiu/issues/541)

**Repo:** [github.com/samarthsinh2660/pre-gsoc](https://github.com/samarthsinh2660/pre-gsoc)

---

## Objective

Design an architecture for a system that efficiently aggregates repository data from
GitHub and serves it to a website while minimising API usage and ensuring scalability.

**Scenario:** An organisation maintains 300+ GitHub repositories. Project information
must be displayed on a website and automatically updated when changes occur.

---

## Documents

| File | Contents |
|---|---|
| [`design.md`](./design.md) | Main design document — all 9 requirements covered |
| [`architecture.md`](./architecture.md) | System diagram (Mermaid) + sequence diagrams |
| [`api-flow.md`](./api-flow.md) | Sequence diagrams: REST, GraphQL, webhook update flow |
| [`tech-stack.md`](./tech-stack.md) | Technology justification with alternatives considered |

---

## Requirements Checklist

| Requirement | Covered in |
|---|---|
| Architecture Design | `design.md` — Architecture Overview section |
| Core Components (ingestion, processing, storage, API, caching) | `design.md` — sections 1–5 |
| Rate Limit Handling | `design.md` — Rate Limit Handling section |
| Update Mechanism (webhooks, scheduled jobs) | `design.md` — Update Mechanism section |
| Data Storage Strategy | `design.md` — Data Storage Strategy section |
| Scalability Plan (300 → 10,000 repos) | `design.md` — Scalability Plan section + `architecture.md` table |
| Performance Optimisation | `design.md` — Performance Optimisation section |
| Failure Handling | `design.md` — Failure Handling table |
| API Flow | `api-flow.md` — REST, GraphQL, and webhook sequence diagrams |
| Technology Choices | `tech-stack.md` — full justification per layer |
| Architecture diagram | `architecture.md` — ASCII + Mermaid |
| 1–2 page design explanation | `design.md` |

---

## Architecture Summary

```
GitHub (REST · GraphQL · Webhooks · Search API)
        │                    │
        ▼                    ▼
  Scheduled Sync       Webhook Receiver
  (BullMQ Cron)       (NestJS + sig validation)
        │                    │
        └──────┬─────────────┘
               ▼
        BullMQ Job Queue
        (Redis-backed, stateless workers)
               │
        ┌──────▼──────────────────────┐
        │ Storage                      │
        │  PostgreSQL  Redis  S3       │
        │  (persist)  (cache) (blobs)  │
        └──────┬───────────────────────┘
               ▼
        NestJS API (REST + GraphQL)
        ETag · Cache-Control · GZIP · ThrottlerGuard
               │
        Angular 17+ Frontend
        HTTP cache interceptor
```

**Key design decisions:**
- Webhook-first updates — one targeted repo refresh per event, not polling all 300
- ETag conditional requests — `304 Not Modified` costs 1 API call, transfers 0 bytes
- Three-layer cache: in-process Map → Redis → PostgreSQL → GitHub API
- Stateless workers — horizontal scaling by adding more worker instances
- Search API for counts — `total_count` in one call, no pagination over all items

---

## Scalability: 300 → 10,000 Repos

| Concern | 300 repos | 10,000 repos |
|---|---|---|
| API quota | 1 token | Token pool (5–10), quota tracked in Redis |
| Workers | 2 BullMQ workers | 20+ stateless workers |
| Database | Single PostgreSQL | + read replicas, partitioned by org |
| Cache | Single Redis | Redis Cluster (sharded) |
| Scheduling | Single cron | Distributed BullMQ repeat, sharded by repo range |
