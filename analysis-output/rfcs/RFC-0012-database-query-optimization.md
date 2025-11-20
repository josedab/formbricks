# RFC-0012: Database Query Optimization & N+1 Prevention

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-17
**Priority:** High (Quick Win)
**Effort:** 1-2 weeks
**Impact:** High (Performance)

## Summary

Systematically eliminate N+1 query problems, add missing indexes, and implement query monitoring to ensure optimal database performance at scale.

## Motivation

**Current Issues:**

**N+1 Query Example:**
```typescript
// apps/web/lib/survey/service.ts
const surveys = await prisma.survey.findMany({ where: { environmentId } });

// ❌ N+1: Separate query for each survey
for (const survey of surveys) {
  const responseCount = await prisma.response.count({
    where: { surveyId: survey.id },
  });
  survey._count = { responses: responseCount };
}
// For 100 surveys = 101 queries!
```

**Performance Impact:**
- P95 latency: 200ms → can be <50ms with proper queries
- Database CPU: 60% → could be <20%
- Response time degradation with scale

**Analysis Findings:**
```bash
# Search for potential N+1 patterns
$ grep -r "\.findMany" apps/web | wc -l
142 occurrences

$ grep -r "for.*await.*prisma" apps/web | wc -l
8 potential N+1 patterns
```

## Detailed Design

### Automatic N+1 Detection

**Prisma Middleware:**
```typescript
// apps/web/lib/prisma/monitoring.ts
import { Prisma } from "@prisma/client";

const queryCount = new Map<string, number>();

export const queryMonitoringMiddleware: Prisma.Middleware = async (params, next) => {
  const requestId = AsyncLocalStorage.getStore()?.requestId || "unknown";

  // Track query count per request
  const count = queryCount.get(requestId) || 0;
  queryCount.set(requestId, count + 1);

  // Warn on excessive queries
  if (count > 10) {
    logger.warn({
      requestId,
      queryCount: count,
      model: params.model,
      action: params.action,
    }, "Potential N+1 query detected");
  }

  const result = await next(params);

  // Clean up after request
  if (count === 0) {
    queryCount.delete(requestId);
  }

  return result;
};

// Enable in development
if (process.env.NODE_ENV === "development") {
  prisma.$use(queryMonitoringMiddleware);
}
```

### Query Optimization Patterns

**Pattern 1: Use `include` for Relations**
```typescript
// ❌ BAD: N+1
const surveys = await prisma.survey.findMany();
for (const survey of surveys) {
  survey.questions = await prisma.question.findMany({
    where: { surveyId: survey.id },
  });
}

// ✅ GOOD: Single query with include
const surveys = await prisma.survey.findMany({
  include: {
    questions: true,
    _count: {
      select: {
        responses: true,
        displays: true,
      },
    },
  },
});
```

**Pattern 2: Batch Queries with `in`**
```typescript
// ❌ BAD: N queries
const users = await getUsers();
for (const user of users) {
  user.memberships = await prisma.membership.findMany({
    where: { userId: user.id },
  });
}

// ✅ GOOD: 2 queries total
const users = await getUsers();
const userIds = users.map(u => u.id);
const memberships = await prisma.membership.findMany({
  where: { userId: { in: userIds } },
});

// Group by userId
const membershipsByUser = groupBy(memberships, "userId");
for (const user of users) {
  user.memberships = membershipsByUser[user.id] || [];
}
```

**Pattern 3: Aggregations in Single Query**
```typescript
// ❌ BAD: N+1
const surveys = await prisma.survey.findMany();
for (const survey of surveys) {
  survey.avgRating = await prisma.response.aggregate({
    where: { surveyId: survey.id },
    _avg: { npsScore: true },
  });
}

// ✅ GOOD: Use groupBy
const surveyRatings = await prisma.response.groupBy({
  by: ["surveyId"],
  where: { surveyId: { in: surveyIds } },
  _avg: { npsScore: true },
});
```

### Missing Index Audit

**Current Indexes:**
```typescript
// Audit script
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function auditIndexes() {
  // Get all tables
  const { stdout } = await execAsync(`
    psql $DATABASE_URL -c "
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    "
  `);

  const tables = stdout.split("\n").filter(Boolean);

  for (const table of tables) {
    // Check for indexes
    const { stdout: indexes } = await execAsync(`
      psql $DATABASE_URL -c "
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = '${table}'
      "
    `);

    console.log(`\n${table}:`);
    console.log(indexes);

    // Check for common query patterns without indexes
    // (analyze slow query log)
  }
}
```

**Recommended Indexes:**
```prisma
// packages/database/schema.prisma

model Response {
  // Existing indexes
  @@index([surveyId])
  @@index([contactId])

  // New indexes for common queries
  @@index([surveyId, finished])      // Survey completion rate
  @@index([surveyId, createdAt])     // Time-based analytics
  @@index([contactId, createdAt])    // User response history
  @@index([finished, createdAt])     // Recent completions
}

model Survey {
  @@index([environmentId])
  @@index([projectId])

  // New
  @@index([environmentId, status])   // Active surveys by env
  @@index([projectId, status])       // Active surveys by project
  @@index([createdAt])               // Recent surveys
}

model Display {
  @@index([surveyId])
  @@index([contactId])

  // New
  @@index([surveyId, createdAt])     // Display frequency
  @@index([contactId, surveyId])     // User display history
}
```

### Query Performance Monitoring

**Slow Query Logging:**
```typescript
// apps/web/lib/prisma/monitoring.ts

const SLOW_QUERY_THRESHOLD_MS = 100;

export const queryPerformanceMiddleware: Prisma.Middleware = async (params, next) => {
  const start = Date.now();
  const result = await next(params);
  const duration = Date.now() - start;

  if (duration > SLOW_QUERY_THRESHOLD_MS) {
    logger.warn({
      model: params.model,
      action: params.action,
      duration,
      args: JSON.stringify(params.args),
    }, "Slow query detected");

    // Send to monitoring (Sentry, Datadog, etc.)
    captureSlowQuery({
      model: params.model,
      action: params.action,
      duration,
      query: params.args,
    });
  }

  return result;
};
```

**Prometheus Metrics:**
```typescript
import { Histogram } from "prom-client";

const dbQueryDuration = new Histogram({
  name: "db_query_duration_seconds",
  help: "Database query latency",
  labelNames: ["model", "action"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
});

export const queryMetricsMiddleware: Prisma.Middleware = async (params, next) => {
  const end = dbQueryDuration.startTimer({
    model: params.model || "unknown",
    action: params.action,
  });

  try {
    return await next(params);
  } finally {
    end();
  }
};
```

## Implementation Plan

### Week 1: Audit & Quick Fixes (Days 1-5)

**Day 1-2: Automated Detection**
- [ ] Implement query monitoring middleware
- [ ] Run N+1 detection in staging
- [ ] Generate report of all N+1 patterns

**Day 3-4: Fix Critical N+1s**
- [ ] Fix top 10 N+1 queries by request volume
- [ ] Add missing includes/select
- [ ] Batch queries where applicable

**Day 5: Index Analysis**
- [ ] Audit existing indexes
- [ ] Analyze slow query log
- [ ] Create migration for missing indexes

### Week 2: Monitoring & Optimization (Days 6-10)

**Day 6-7: Monitoring**
- [ ] Deploy slow query logging
- [ ] Set up Prometheus metrics
- [ ] Create Grafana dashboard

**Day 8-9: Remaining Optimizations**
- [ ] Fix remaining N+1s
- [ ] Optimize complex queries
- [ ] Add query result caching

**Day 10: Documentation**
- [ ] Document query patterns
- [ ] Create developer guide
- [ ] Add to code review checklist

## Success Metrics

**Before:**
- P95 API latency: 200ms
- Database queries per request: 15-20
- Database CPU: 60%
- Slow queries (>100ms): 15%

**After:**
- P95 API latency: <100ms (-50%)
- Database queries per request: <5 (-70%)
- Database CPU: <30% (-50%)
- Slow queries (>100ms): <2% (-87%)

## Testing Strategy

**Load Testing:**
```typescript
// test-n1-improvement.ts
import autocannon from "autocannon";

async function testEndpoint(url: string) {
  const result = await autocannon({
    url,
    connections: 50,
    duration: 30,
  });

  return {
    rps: result.requests.average,
    p95: result.latency.p95,
    p99: result.latency.p99,
  };
}

// Before optimization
const before = await testEndpoint("/api/v2/management/surveys");

// Apply fix
applyOptimization();

// After optimization
const after = await testEndpoint("/api/v2/management/surveys");

console.log("Improvement:", {
  rpsIncrease: ((after.rps - before.rps) / before.rps * 100).toFixed(1) + "%",
  p95Decrease: ((before.p95 - after.p95) / before.p95 * 100).toFixed(1) + "%",
});
```

## Monitoring Dashboard

**Grafana Panels:**
1. Database queries per request (target: <5)
2. Slow query rate (target: <2%)
3. P95 query latency (target: <50ms)
4. N+1 warning count (target: 0)
5. Database connection pool usage

**Alerts:**
- Slow query rate >5% for 5 minutes
- P95 latency >200ms for 5 minutes
- N+1 warnings >10/hour
