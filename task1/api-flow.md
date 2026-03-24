# API Flow Description

How the frontend retrieves repository data from the backend.

---

## Endpoint Map

| Frontend need | Endpoint | GraphQL alternative |
|---|---|---|
| Project list | `GET /api/v1/projects` | `query { projects { name stars forks language } }` |
| Project detail | `GET /api/v1/projects/:name` | `query ProjectDetails { projectDetails(name: $name) { ... } }` |
| Contributors list | `GET /api/v1/contributor/contributors` | — (REST + enriched endpoint) |
| Contributor profile | `GET /api/v1/contributor/:username/stats` | `query ContributorProfile { contributorProfile(username: $u) { ... } }` |
| Issues and PR counts | `GET /api/v1/issues/issuesAndPr` | included in `projectDetails` |
| Project search | `GET /api/v1/projects/search?q=` | same endpoint |

---

## Standard Request Flow (REST)

```
Frontend                    NestJS API                 Redis         PostgreSQL      GitHub API
   │                             │                        │               │               │
   │  GET /api/v1/projects       │                        │               │               │
   │  If-None-Match: "etag-xyz"  │                        │               │               │
   │────────────────────────────►│                        │               │               │
   │                             │  GET "projects_list"   │               │               │
   │                             │───────────────────────►│               │               │
   │                             │                        │               │               │
   │                             │  ┌─ Cache HIT ─────────┤               │               │
   │                             │  │  ETag matches        │               │               │
   │◄────────────────────────────│──┘  304 Not Modified   │               │               │
   │                             │                        │               │               │
   │  (next request, stale ETag) │                        │               │               │
   │────────────────────────────►│                        │               │               │
   │                             │  GET "projects_list"   │               │               │
   │                             │───────────────────────►│               │               │
   │                             │  MISS                  │               │               │
   │                             │◄───────────────────────│               │               │
   │                             │  SELECT * FROM repos   │               │               │
   │                             │────────────────────────────────────────►               │
   │                             │◄────────────────────────────────────────               │
   │                             │  SET "projects_list" TTL=300s          │               │
   │                             │───────────────────────►│               │               │
   │◄────────────────────────────│                        │               │               │
   │  200 OK                     │                        │               │               │
   │  ETag: "etag-new"           │                        │               │               │
   │  Cache-Control: max-age=300 │                        │               │               │
```

---

## Multi-Source GraphQL Flow (ProjectDetailsResolver)

Used when the frontend needs project metadata + insights + contributors in one view.
Without GraphQL this is 3 separate REST requests. With the resolver it is one query.

```
Frontend                    GraphQL API                 Service Layer          Redis
   │                             │                            │                  │
   │  POST /graphql              │                            │                  │
   │  query ProjectDetails {     │                            │                  │
   │    projectDetails(          │                            │                  │
   │      name: "Webiu") { ... } │                            │                  │
   │  }                          │                            │                  │
   │────────────────────────────►│                            │                  │
   │                             │  ProjectDetailsResolver    │                  │
   │                             │  Promise.all([             │                  │
   │                             │    getProjectByName()  ────────────────────► │
   │                             │    getProjectInsights()────────────────────► │
   │                             │    getProjectContributors()────────────────► │
   │                             │  ])                        │                  │
   │                             │                            │  all cache hits  │
   │                             │◄───────────────────────────────────────────── │
   │                             │  merge + field-select      │                  │
   │◄────────────────────────────│                            │                  │
   │  200 OK                     │                            │                  │
   │  { projectDetails: {        │                            │                  │
   │      name, stars,           │                            │                  │
   │      insights: { ... },     │                            │                  │
   │      contributors: [ ... ]  │                            │                  │
   │  }}                         │                            │                  │
```

All three service calls run in parallel. All three read from Redis (already cached).
No new GitHub API call is made. The resolver merges the results and returns only the
fields the client declared in the query.

---

## Webhook-Triggered Update → Frontend Sees Fresh Data

```
GitHub          Webhook Receiver     BullMQ Queue      Worker       PostgreSQL     Redis
   │                  │                   │               │               │           │
   │  push event      │                   │               │               │           │
   │─────────────────►│                   │               │               │           │
   │                  │  validate sig     │               │               │           │
   │                  │  enqueue job      │               │               │           │
   │                  │──────────────────►│               │               │           │
   │◄─────────────────│  200 OK           │               │               │           │
   │                  │                   │  dispatch     │               │           │
   │                  │                   │──────────────►│               │           │
   │                  │                   │               │  fetch repo   │           │
   │                  │                   │               │  (If-None-    │           │
   │                  │                   │               │   Match ETag) │           │
   │◄──────────────────────────────────────────────────── │  200 new data │           │
   │                  │                   │               │  UPDATE repo  │           │
   │                  │                   │               │──────────────►│           │
   │                  │                   │               │  DEL cache key│           │
   │                  │                   │               │───────────────────────────►
   │                  │                   │               │               │           │
   │                  │                   │  (next frontend request fetches fresh DB data)
```

---

## Error Response Contract

All API errors follow a consistent shape:

```json
{
  "statusCode": 503,
  "error": "Service Unavailable",
  "message": "GitHub API rate limit exhausted. Retry after 2026-03-25T14:00:00Z",
  "retryAfter": "2026-03-25T14:00:00Z",
  "stale": true,
  "data": { ... }
}
```

When `stale: true`, the response still contains the last known data so the frontend
can render something meaningful rather than a blank error state.
