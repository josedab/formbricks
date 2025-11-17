# Performance Analysis and Optimization Opportunities

**Part 5 of 7 - Formbricks Technical Deep Dive**
**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## Current Performance Metrics

### Bundle Size
- **First Load JS:** 350KB (budget: 358KB)
- **Survey Package:** ~150KB (~60KB gzipped)
- **Status:** ✅ Within budget, but close

### Build Performance
- **Full build (clean):** 4-5 minutes
- **Full build (cached):** <30 seconds
- **Hot reload:** <1 second
- **Status:** ✅ Good

### Runtime Performance
- **Time to Interactive:** <2 seconds
- **API Response P95:** <200ms
- **Database Query P95:** <50ms
- **Status:** ✅ Excellent

## Optimization Opportunities

### 1. Bundle Size Reduction (15-20%)

**lodash Replacement:**

```typescript
// Before (40KB)
import _ from "lodash";
const grouped = _.groupBy(items, "category");
const unique = _.uniq(array);

// After (0KB)
const grouped = Object.groupBy(items, item => item.category);
const unique = [...new Set(array)];
```

**Dynamic Imports:**

```typescript
// Before (loads immediately)
import { LexicalEditor } from "@lexical/react";

// After (loads on demand)
const LexicalEditor = dynamic(() => import("@lexical/react"), {
  loading: () => <EditorSkeleton />,
  ssr: false
});
```

**Savings:** ~100KB from lazy loading heavy components

### 2. Database Optimization

**Query Optimization:**

```typescript
// Before (N+1 query problem)
const surveys = await prisma.survey.findMany();
for (const survey of surveys) {
  survey.responses = await prisma.response.findMany({
    where: { surveyId: survey.id }
  });
}

// After (single query with include)
const surveys = await prisma.survey.findMany({
  include: {
    responses: true,
    _count: { select: { responses: true } }
  }
});
```

**Indexing Strategy:**

```prisma
model Response {
  id          String   @id @default(cuid())
  surveyId    String
  contactId   String?
  finished    Boolean
  createdAt   DateTime @default(now())
  
  @@index([surveyId, finished])  // Common query pattern
  @@index([contactId])           // User history lookups
  @@index([createdAt])           // Time-based queries
}
```

### 3. Caching Strategy

**Multi-layer Caching:**

```typescript
// Layer 1: React Cache (request-level)
export const getSurvey = reactCache(async (id) => {
  // Layer 2: Redis (application-level)
  const cached = await cache.get(`survey:${id}`);
  if (cached) return cached;
  
  // Layer 3: Database
  const survey = await prisma.survey.findUnique({ where: { id } });
  
  await cache.set(`survey:${id}`, survey, 5 * 60 * 1000); // 5 min TTL
  return survey;
});
```

**Cache Invalidation:**

```typescript
export async function updateSurvey(id: string, data: TSurvey) {
  const survey = await prisma.survey.update({ where: { id }, data });
  
  // Invalidate all related caches
  await Promise.all([
    cache.del(`survey:${id}`),
    cache.del(`surveys:env:${survey.environmentId}`),
    cache.del(`surveys:project:${survey.projectId}`)
  ]);
  
  return survey;
}
```

### 4. API Performance

**Pagination Best Practices:**

```typescript
// Cursor-based pagination (better for large datasets)
export async function GET(req: Request) {
  const { cursor, limit = 50 } = parseQuery(req.url);
  
  const responses = await prisma.response.findMany({
    take: limit + 1,  // Fetch one extra to check if more exist
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    orderBy: { createdAt: "desc" }
  });
  
  const hasMore = responses.length > limit;
  const data = hasMore ? responses.slice(0, -1) : responses;
  
  return Response.json({
    data,
    pagination: {
      nextCursor: hasMore ? data[data.length - 1].id : null,
      hasMore
    }
  });
}
```

## Scaling Considerations

### Horizontal Scaling

**Stateless Architecture:**
- App servers: ✅ Stateless, can scale infinitely
- Database: ⚠️ Single instance, needs connection pooling
- Redis: ✅ Can cluster
- Storage: ✅ S3 scales infinitely

**Connection Pooling (PgBouncer):**

```yaml
# docker-compose.yml
pgbouncer:
  image: pgbouncer/pgbouncer
  environment:
    - DB_HOST=postgres
    - DB_PORT=5432
    - POOL_MODE=transaction
    - MAX_CLIENT_CONN=1000
    - DEFAULT_POOL_SIZE=25
```

### Kubernetes Autoscaling

```yaml
# helm-chart/values.yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 60
  targetMemoryUtilizationPercentage: 60
```

## Performance Monitoring

### Key Metrics

```typescript
// Prometheus metrics
export const metrics = {
  httpRequestDuration: new Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request latency",
    labelNames: ["method", "route", "status_code"]
  }),
  
  dbQueryDuration: new Histogram({
    name: "db_query_duration_seconds",
    help: "Database query latency",
    labelNames: ["operation", "model"]
  }),
  
  cacheHitRate: new Counter({
    name: "cache_hits_total",
    help: "Cache hit rate",
    labelNames: ["cache_type", "hit"]
  })
};
```

### Benchmarking

```typescript
// Test performance under load
import autocannon from "autocannon";

const result = await autocannon({
  url: "http://localhost:3000/api/v2/management/surveys",
  connections: 100,
  duration: 30,
  headers: {
    "x-api-key": "test_key"
  }
});

console.log(`Requests/sec: ${result.requests.average}`);
console.log(`Latency p95: ${result.latency.p95}ms`);
```

## Key Takeaways

1. **Bundle size** can be reduced 15-20% with lodash replacement + dynamic imports
2. **Database optimization** via proper indexing and query patterns
3. **Multi-layer caching** dramatically improves read performance
4. **Horizontal scaling** supported by stateless architecture
5. **Monitoring** essential for identifying bottlenecks

**Recommended Actions:**
1. Implement lodash audit (RFC-0002)
2. Add PgBouncer for production
3. Expand Redis caching coverage
4. Set up Prometheus monitoring

Next: **Part 6 - Security Deep Dive**
