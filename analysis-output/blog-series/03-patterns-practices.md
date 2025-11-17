# Patterns and Practices in Formbricks

**Part 3 of 7 - Formbricks Technical Deep Dive**
**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## What You'll Learn

- Service layer pattern for business logic separation
- Result type for graceful error handling
- Type-safe architecture (Zod + TypeScript + Prisma)
- Server Actions and authentication
- Rate limiting implementation

## Service Layer Pattern

**File Location:** `apps/web/lib/*/service.ts`

**Core Pattern:**
```typescript
import "server-only";  // Compile error if used in client
import { reactCache } from "react";

export const getSurvey = reactCache(
  async (surveyId: string): Promise<TSurvey | null> => {
    // 1. Input validation
    validateInputs([surveyId, ZId]);
    
    // 2. Database query
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      select: selectSurvey
    });
    
    if (!survey) return null;
    
    // 3. Transform to domain type
    return transformPrismaSurvey(survey);
  }
);
```

**Benefits:**
- **Separation of concerns:** Business logic separate from API/UI
- **Reusability:** Used by API routes, server actions, server components
- **Caching:** `reactCache` deduplicates within single request
- **Type safety:** Prisma → Domain type transformation

## Result Type Pattern

**Inspired by Rust**, handles errors without exceptions:

```typescript
type Result<T, E> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

// Cache service example
const result = await cache.get("key");
if (result.ok) {
  return result.data;
}
// Fallback - cache failure doesn't break app
return await fetchFromDatabase();
```

**Use Cases:**
- Cache operations (optional, can fail gracefully)
- Storage operations (S3 might be unavailable)
- External API calls

## Type-Safe Everything

**Three Layers:**

1. **Compile-time:** TypeScript strict mode
2. **Runtime:** Zod validation
3. **Database:** Prisma type generation

```typescript
// 1. Define Zod schema
export const ZSurveyCreateInput = z.object({
  name: z.string().min(1),
  type: z.enum(["link", "app"]),
  questions: z.array(ZSurveyQuestion).min(1)
});

// 2. Infer TypeScript type
export type TSurveyCreateInput = z.infer<typeof ZSurveyCreateInput>;

// 3. Validate at boundary
export async function POST(req: Request) {
  const body = await req.json();
  const validated = ZSurveyCreateInput.parse(body); // Throws if invalid
  return await createSurvey(validated);
}

// 4. Prisma enforces database schema
const survey = await prisma.survey.create({
  data: validated  // Type-safe!
});
```

## Server Actions Architecture

**Builder Pattern** with `next-safe-action`:

```typescript
export const actionClient = createSafeActionClient({
  handleServerError(e) {
    if (e instanceof ResourceNotFoundError) return e.message;
    Sentry.captureException(e);
    return "An error occurred";
  }
});

export const authenticatedActionClient = actionClient
  .use(async ({ ctx, next }) => {
    const session = await getServerSession();
    if (!session) throw new AuthenticationError();
    return next({ ctx: { ...ctx, user: session.user } });
  });

// Usage
export const updateSurveyAction = authenticatedActionClient
  .schema(ZUpdateSurveyInput)
  .action(async ({ ctx, parsedInput }) => {
    await checkAuthorization(ctx.user.id, parsedInput.surveyId);
    return await updateSurvey(parsedInput);
  });
```

**Features:**
- Automatic validation
- Type-safe client calls
- Centralized error handling
- Middleware chain (auth, logging, etc.)

## Rate Limiting

**Redis-based sliding window:**

```typescript
// modules/core/rate-limit/rate-limit.ts
export async function rateLimit(
  identifier: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redis = await getRedisClient();
  const key = `rate-limit:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;
  
  // Remove old entries
  await redis.zremrangebyscore(key, 0, windowStart);
  
  // Count requests in window
  const count = await redis.zcard(key);
  
  if (count >= limit) {
    return { allowed: false, remaining: 0 };
  }
  
  // Add this request
  await redis.zadd(key, now, `${now}`);
  await redis.expire(key, Math.ceil(windowMs / 1000));
  
  return { allowed: true, remaining: limit - count - 1 };
}
```

**Usage:**
```typescript
const result = await rateLimit(ip, 100, 60000); // 100 req/min
if (!result.allowed) {
  return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
}
```

## Testing Patterns

**Standard Structure:**
```typescript
describe("getSurvey", () => {
  describe("Happy Path", () => {
    test("returns survey when found", async () => {
      prismaMock.survey.findUnique.mockResolvedValue(mockSurvey);
      const result = await getSurvey("123");
      expect(result).toEqual(mockSurvey);
    });
  });
  
  describe("Sad Path", () => {
    test("returns null when not found", async () => {
      prismaMock.survey.findUnique.mockResolvedValue(null);
      const result = await getSurvey("123");
      expect(result).toBeNull();
    });
  });
  
  describe("Input Validation", () => {
    test("throws on invalid ID", async () => {
      await expect(getSurvey("")).rejects.toThrow(ValidationError);
    });
  });
});
```

## Key Takeaways

1. **Service layer** provides clean abstraction
2. **Result type** enables graceful degradation
3. **Type safety** at three layers prevents bugs
4. **Server Actions** simplify client-server communication
5. **Rate limiting** protects against abuse

Next: **Part 4 - Extending and Integrating Formbricks**
