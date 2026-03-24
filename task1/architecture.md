# Architecture Diagram

## Full System — Mermaid

```mermaid
flowchart TD
    GH["GitHub Platform\nREST · GraphQL · Webhooks · Search API"]

    subgraph Ingestion["Ingestion Layer"]
        WH["Webhook Receiver\nNestJS Controller\nX-Hub-Signature-256 validation"]
        SCHED["Scheduled Sync\nBullMQ Cron — every 6h\nETag conditional checks"]
    end

    subgraph Queue["Processing Layer"]
        BQ["BullMQ Job Queue\n(Redis-backed)"]
        W1["Worker 1"]
        W2["Worker 2"]
        WN["Worker N"]
        NOTE["Stateless workers —\nadd more to scale"]
    end

    subgraph Storage["Storage Layer"]
        PG[("PostgreSQL\nrepos · contributors\nlanguages · releases\ncomputed scores")]
        RD[("Redis\nL2 cache · ETags\nrate-limit counters\njob dedup keys")]
        S3[("S3 / Object Store\nREADME blobs\nAI summaries\ntree snapshots")]
    end

    subgraph API["API Layer"]
        NJ["NestJS\nREST + GraphQL\nThrottlerGuard\nETag · Cache-Control\nGZIP compression"]
    end

    subgraph Frontend["Frontend"]
        ANG["Angular 17+\nHTTP cache interceptor\nService Worker"]
    end

    GH -- "push / PR / release events" --> WH
    GH -- "REST / GraphQL (ETag)" --> SCHED

    WH --> BQ
    SCHED --> BQ

    BQ --> W1
    BQ --> W2
    BQ --> WN

    W1 --> PG
    W2 --> PG
    WN --> PG
    W1 --> RD
    W2 --> RD
    W1 --> S3

    NJ -- "L1: in-process map" --> NJ
    NJ -- "L2: Redis lookup" --> RD
    NJ -- "L3: DB read" --> PG
    NJ -- "README / AI summary" --> S3

    ANG -- "GET with If-None-Match" --> NJ
    NJ -- "200 / 304 + ETag" --> ANG
```

---

## Cache Hit Flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as NestJS API
    participant L1 as In-Process Cache
    participant L2 as Redis
    participant L3 as PostgreSQL

    FE->>API: GET /api/v1/projects (If-None-Match: "abc")
    API->>L1: check key
    alt L1 hit and ETag matches
        API->>FE: 304 Not Modified
    else L1 miss
        API->>L2: check key
        alt L2 hit
            API->>L1: populate
            API->>FE: 200 + ETag + Cache-Control
        else L2 miss
            API->>L3: SELECT * FROM repos
            L3->>API: rows
            API->>L2: SET key (TTL 300s)
            API->>L1: SET key (TTL 60s)
            API->>FE: 200 + ETag + Cache-Control
        end
    end
```

---

## Webhook Update Flow

```mermaid
sequenceDiagram
    participant GH as GitHub
    participant WH as Webhook Receiver
    participant Q as BullMQ Queue
    participant W as Worker
    participant DB as PostgreSQL
    participant RD as Redis

    GH->>WH: POST /webhooks/github (push event)
    WH->>WH: validate X-Hub-Signature-256
    WH->>Q: enqueue job { repo: "org/repo" }
    WH->>GH: 200 OK (fast ack)

    Q->>W: dispatch job
    W->>GH: GET /repos/org/repo (If-None-Match: cached_etag)
    alt 304 Not Modified
        W->>RD: refresh TTL only
    else 200 with new data
        W->>DB: UPDATE repos SET ...
        W->>RD: DEL cache key (invalidate)
    end
```

---

## Scalability: 300 → 10,000 Repos

```
300 repos                          10,000 repos
─────────────────────────────────────────────────────────────────────
1 GitHub token                     Token pool (5-10 tokens)
  5,000 req/hr shared                Round-robin by remaining quota
                                     tracked in Redis

2 BullMQ workers                   20+ workers (horizontal scale)
  single Redis instance              Redis Cluster (sharded)

Single PostgreSQL                  PostgreSQL + 2 read replicas
                                     Partitioned by org prefix

Single NestJS instance             NestJS behind load balancer
                                     All state external (Redis + PG)

Single cron job (6h scan)          Distributed BullMQ repeat jobs
                                     Sharded by repo ID range
                                     Different tokens per shard
```
