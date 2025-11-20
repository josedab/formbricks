# RFC-0011: Webhook Retry Logic & Dead Letter Queue

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-17
**Priority:** High (Strategic)
**Effort:** 1-2 weeks
**Impact:** High (Webhook reliability)

## Summary

Implement exponential backoff retry logic and dead letter queue (DLQ) for failed webhooks to ensure reliable delivery of events to external systems. Currently, webhooks are fire-and-forget with no retry mechanism.

## Motivation

**Current Problem:**
```typescript
// apps/web/app/api/(internal)/pipeline/route.ts
const webhookPromises = webhooks.map((webhook) =>
  fetchWithTimeout(webhook.url, {
    method: "POST",
    headers: webhookHeaders,
    body: JSON.stringify(payload),
  }).catch((error) => {
    logger.error({ error }, `Webhook call to ${webhook.url} failed`);
    // ❌ Webhook lost forever!
  })
);
```

**Issues:**
- ❌ No retry on transient failures (network errors, 5xx responses)
- ❌ No visibility into failed webhooks
- ❌ No way to replay failed events
- ❌ Users miss critical events due to temporary outages

**Business Impact:**
- Customers lose integration data during downtime
- Support tickets for "missing webhook events"
- Poor integration reliability compared to competitors

## Detailed Design

### Database Schema

```prisma
model WebhookDelivery {
  id              String                @id @default(cuid())
  webhookId       String
  webhook         Webhook               @relation(fields: [webhookId], references: [id], onDelete: Cascade)

  event           PipelineTriggers
  payload         Json

  status          WebhookDeliveryStatus @default(pending)
  attempts        Int                   @default(0)
  maxAttempts     Int                   @default(5)

  nextRetryAt     DateTime?
  lastAttemptAt   DateTime?
  firstAttemptAt  DateTime              @default(now())
  succeededAt     DateTime?
  failedAt        DateTime?

  lastError       String?
  lastStatusCode  Int?

  createdAt       DateTime              @default(now())
  updatedAt       DateTime              @updatedAt

  @@index([webhookId, status])
  @@index([status, nextRetryAt])
}

enum WebhookDeliveryStatus {
  pending       // Queued for delivery
  delivering    // Currently being sent
  succeeded     // Successfully delivered
  failed        // Permanently failed (exceeded max attempts)
  cancelled     // Manually cancelled
}
```

### Retry Strategy

**Exponential Backoff:**
```typescript
function calculateNextRetry(attempt: number): Date {
  // Retry schedule: 30s, 2m, 5m, 15m, 1h
  const delays = [30, 120, 300, 900, 3600]; // seconds
  const delay = delays[Math.min(attempt, delays.length - 1)];

  return new Date(Date.now() + delay * 1000);
}
```

**Retry Logic:**
```typescript
async function deliverWebhook(delivery: WebhookDelivery) {
  try {
    const response = await fetchWithTimeout(delivery.webhook.url, {
      method: "POST",
      headers: getWebhookHeaders(delivery.payload, delivery.webhook.secret),
      body: JSON.stringify(delivery.payload),
    });

    if (response.ok) {
      // Success
      await prisma.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "succeeded",
          succeededAt: new Date(),
          lastStatusCode: response.status,
        },
      });
    } else if (response.status >= 500 || response.status === 429) {
      // Retry on 5xx or rate limit
      await scheduleRetry(delivery);
    } else {
      // Permanent failure (4xx except 429)
      await markAsFailed(delivery, `HTTP ${response.status}`);
    }
  } catch (error) {
    // Network error - retry
    await scheduleRetry(delivery);
  }
}

async function scheduleRetry(delivery: WebhookDelivery) {
  const nextAttempt = delivery.attempts + 1;

  if (nextAttempt >= delivery.maxAttempts) {
    await markAsFailed(delivery, "Max attempts exceeded");
    await sendToDeadLetterQueue(delivery);
  } else {
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "pending",
        attempts: nextAttempt,
        nextRetryAt: calculateNextRetry(nextAttempt),
        lastAttemptAt: new Date(),
      },
    });
  }
}
```

### Dead Letter Queue

**Store Failed Deliveries:**
```typescript
model WebhookDeadLetter {
  id              String   @id @default(cuid())
  deliveryId      String   @unique
  delivery        WebhookDelivery @relation(fields: [deliveryId], references: [id])

  reason          String
  retriable       Boolean  @default(true)
  replayedAt      DateTime?

  createdAt       DateTime @default(now())

  @@index([retriable, createdAt])
}
```

**Replay Interface:**
```typescript
// Admin API to replay failed webhooks
export async function replayWebhook(deadLetterId: string) {
  const dlq = await prisma.webhookDeadLetter.findUnique({
    where: { id: deadLetterId },
    include: { delivery: { include: { webhook: true } } },
  });

  // Create new delivery attempt
  const newDelivery = await prisma.webhookDelivery.create({
    data: {
      webhookId: dlq.delivery.webhookId,
      event: dlq.delivery.event,
      payload: dlq.delivery.payload,
      status: "pending",
    },
  });

  // Mark DLQ as replayed
  await prisma.webhookDeadLetter.update({
    where: { id: deadLetterId },
    data: { replayedAt: new Date() },
  });

  return newDelivery;
}
```

### Background Worker

**Cron Job:**
```typescript
// apps/web/app/api/cron/process-webhooks/route.ts
export async function GET(request: Request) {
  // Auth check
  if (request.headers.get("x-api-key") !== CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get pending deliveries ready for retry
  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      status: "pending",
      nextRetryAt: { lte: new Date() },
    },
    include: { webhook: true },
    take: 100,
  });

  // Process in parallel (with concurrency limit)
  const results = await pMap(deliveries, deliverWebhook, { concurrency: 10 });

  return Response.json({
    processed: results.length,
    succeeded: results.filter((r) => r.status === "succeeded").length,
    failed: results.filter((r) => r.status === "failed").length,
  });
}
```

## Implementation Plan

### Phase 1: Database & Core Logic (Days 1-3)
- [ ] Create Prisma migration for WebhookDelivery and WebhookDeadLetter
- [ ] Implement retry logic with exponential backoff
- [ ] Implement DLQ storage

### Phase 2: Worker & Cron (Days 4-5)
- [ ] Create cron job for processing retries
- [ ] Implement delivery tracking
- [ ] Add monitoring and alerting

### Phase 3: Admin UI (Days 6-8)
- [ ] Webhook delivery history page
- [ ] Dead letter queue viewer
- [ ] Manual replay interface

### Phase 4: Testing & Documentation (Days 9-10)
- [ ] Write integration tests
- [ ] Load testing
- [ ] User documentation

## Success Metrics

- **Delivery Success Rate:** >99% within 1 hour (up from ~95% immediate)
- **Failed Webhook Visibility:** 100% of failures tracked
- **Recovery Time:** <5 minutes for transient failures
- **Support Tickets:** -50% webhook-related issues

## Alternatives Considered

**Queue System (BullMQ):**
- Pros: Mature, feature-rich, better for high volume
- Cons: Extra dependency, operational complexity
- Decision: Start simple with DB-based approach, migrate to queue if needed

**Third-party Service (Svix):**
- Pros: Zero implementation, enterprise features
- Cons: Cost, vendor lock-in, data privacy
- Decision: Build in-house for control and cost
