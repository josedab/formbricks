# Understanding Formbricks: Architecture and Core Concepts

**Part 1 of 7 in the Formbricks Technical Deep Dive Series**
**Analysis Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

---

## What You'll Learn

- Why Formbricks chose a modular monolith over microservices
- How the Next.js 15 App Router powers the platform
- The technology stack and architectural tradeoffs
- Core domain concepts (Survey, Contact, Environment, Response)
- How everything fits together in production

---

## Introduction: The Open-Source Qualtrics Alternative

Formbricks is tackling a deceptively complex problem: making user feedback collection **simple for developers** while providing **enterprise-grade features** for product teams. After analyzing the codebase at commit 341e263, I'm impressed by the architectural decisions that balance these competing concerns.

Let's explore how Formbricks is built, starting with the big picture.

---

## The Architecture Decision: Modular Monolith

### Why Not Microservices?

When building a survey platform, you might assume microservices would be ideal—separate services for survey management, response collection, integrations, etc. Formbricks went a different route: a **modular monolith** organized as a **monorepo**.

**The Tradeoff:**

**Microservices Benefits (What We Give Up):**
- Independent scaling of services
- Technology diversity per service
- Team autonomy on deployments

**Modular Monolith Benefits (What We Gain):**
- Simpler deployment (one artifact)
- Shared code without duplication
- Atomic transactions across domains
- Lower operational complexity
- Faster local development

For Formbricks, the monolith wins because:
1. **Transactions matter** - Creating a survey involves updating surveys, action classes, and segments atomically
2. **Shared types** - Type safety across all features with zero network overhead
3. **Developer experience** - New contributors can run the entire stack locally in minutes
4. **Cost** - Self-hosters deploy one container, not 10+

**But this isn't a big ball of mud.** The codebase uses clear module boundaries:

```
apps/web/modules/
├── survey/          # Survey management domain
├── analysis/        # Response analytics domain
├── integrations/    # Third-party connections
├── organization/    # Multi-tenancy domain
└── ee/              # Enterprise features (separate license)
```

Each module is self-contained with its own components, business logic, and server actions.

---

## The Technology Stack: Modern and Opinionated

Let's examine the core technologies and understand *why* each was chosen:

### Next.js 15 with App Router

**Version:** 15.5.6 (latest stable)

**Why Next.js?**
- **Full-stack framework** - API routes + frontend in one codebase
- **React Server Components** - Server-side data fetching with zero client JS
- **Edge runtime** - Deploy globally with low latency
- **Vercel ecosystem** - First-class deployment support

**Example: Server Component for Survey List**

```typescript
// apps/web/modules/survey/list/page.tsx
export default async function SurveysPage({ 
  params 
}: { 
  params: { environmentId: string } 
}) {
  // Direct database access in Server Component - no API call!
  const surveys = await getSurveys(params.environmentId);
  const environment = await getEnvironment(params.environmentId);
  
  return <SurveysList surveys={surveys} environment={environment} />;
}
```

**The Tradeoff:** Next.js is opinionated. You follow the framework's patterns or fight it. For Form bricks, this constraint is a feature—it prevents bikeshedding and keeps the codebase consistent.

### Prisma 6 + PostgreSQL

**Why Prisma?**
- **Type-safe queries** - Database schema generates TypeScript types
- **Migrations** - Schema changes tracked in version control
- **Great DX** - Autocomplete for queries, clear error messages

**Example: Type-Safe Query**

```typescript
// This query is fully typed at compile time
const survey = await prisma.survey.findUnique({
  where: { id: surveyId },
  include: {
    questions: true,
    triggers: true,
    environment: {
      include: { project: { include: { organization: true } } }
    }
  }
});
// survey.questions[0].text ✅ Autocomplete works!
```

**Why PostgreSQL + pgvector?**
- **Reliability** - Battle-tested ACID compliance
- **pgvector extension** - Vector similarity search for AI features
- **Rich data types** - JSONB for flexible schema evolution
- **Ecosystem** - Every host supports it

**The Tradeoff:** PostgreSQL isn't infinitely scalable horizontally. But for 99% of Form bricks deployments, a single Postgres instance with read replicas is sufficient. The 1% using Formbricks Cloud gets managed scaling.

### TypeScript 5.8 in Strict Mode

**Strict mode enabled:**
```json
{
  "strict": true,
  "strictNullChecks": true,
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

**Why strict mode?** Because survey logic bugs in production are expensive. A null check caught at compile time saves hours of debugging.

**Combined with Zod for runtime validation:**

```typescript
// Define schema once, get both runtime validation and types
export const ZSurveyCreateInput = z.object({
  name: z.string().min(1),
  type: z.enum(["link", "app"]),
  questions: z.array(ZSurveyQuestion).min(1)
});

export type TSurveyCreateInput = z.infer<typeof ZSurveyCreateInput>;

// Use in API route
export async function POST(req: Request) {
  const body = await req.json();
  const validated = ZSurveyCreateInput.parse(body); // Throws if invalid
  return await createSurvey(validated); // Type-safe!
}
```

**The Pattern:** Every boundary (API, database, external service) has a Zod schema. No data enters the system unvalidated.

---

## Core Domain Model

Let's understand the foundational concepts that everything else builds upon:

### Multi-Tenancy Hierarchy

```
Organization (Acme Corp)
  ├── Project (Mobile App)
  │   ├── Environment (Production)
  │   │   ├── Surveys
  │   │   ├── Contacts (users)
  │   │   ├── Responses
  │   │   └── API Keys
  │   └── Environment (Development)
  └── Project (Website)
```

**Why this structure?**
- **Organization** - Billing entity, team management
- **Project** - Logical product/application boundary
- **Environment** - Isolate production from test data

**Database Implementation:**

```prisma
model Organization {
  id       String    @id @default(cuid())
  name     String
  projects Project[]
  members  Membership[]
  billing  Json      // Stripe subscription, limits
}

model Project {
  id             String        @id @default(cuid())
  name           String
  organization   Organization  @relation(...)
  environments   Environment[]
}

model Environment {
  id            String   @id @default(cuid())
  type          String   // "production" | "development"
  project       Project  @relation(...)
  surveys       Survey[]
  contacts      Contact[]
  apiKeys       ApiKey[]
}
```

### The Survey Lifecycle

A survey in Formbricks has four states:

```typescript
enum SurveyStatus {
  draft        // Being edited
  inProgress   // Live and collecting responses
  paused       // Temporarily disabled
  completed    // Archived
}
```

**State transitions:**

```
draft → inProgress → paused ⟷ inProgress → completed
                               ↓
                          completed
```

**Why explicit states?** Because surveys have complex business rules:
- Draft surveys aren't sent to the SDK
- In-progress surveys enforce display rules
- Paused surveys maintain state for resumption
- Completed surveys are read-only (for audit trails)

### Contact: The Tracked User

```typescript
interface Contact {
  id: string;
  userId: string | null;        // Your app's user ID
  attributes: ContactAttribute[]; // Custom data
  responses: Response[];
  displays: Display[];           // When surveys were shown
}
```

**Key insight:** Contacts can exist *before* they respond to a survey. Formbricks tracks:
1. When a survey was displayed (even if not completed)
2. User attributes at that moment (for segmentation)
3. Response history (for recontact rules)

**Example: Targeting "Power Users"**

```typescript
const powerUserSegment = {
  title: "Power Users",
  filters: [
    { type: "attribute", key: "plan", operator: "equals", value: "pro" },
    { type: "attribute", key: "loginCount", operator: "greaterThan", value: 50 }
  ]
};

// When SDK calls formbricks.track(), the backend evaluates:
// 1. Does this contact match the segment?
// 2. Have they seen this survey recently? (recontact rules)
// 3. Have they hit the response limit?
// → Only then is the survey displayed
```

### Response: The Collected Data

```prisma
model Response {
  id          String   @id @default(cuid())
  surveyId    String
  contactId   String?
  
  data        Json     // { "q1": "Yes", "q2": 5 }
  variables   Json     // Calculated values
  ttc         Json     // Time-to-complete per question
  meta        Json     // Browser, device, location
  
  finished    Boolean  // Completion status
  createdAt   DateTime
  updatedAt   DateTime
}
```

**Why separate `data`, `variables`, and `meta`?**
- **data** - Raw answers (immutable after submission)
- **variables** - Calculated values (scores, aggregations)
- **meta** - Context for analysis (browser, country, etc.)
- **ttc** - Time-to-complete helps identify confusing questions

---

## How It All Fits Together: A User Journey

Let's trace a complete survey response through the system:

### 1. Developer Installs SDK

```javascript
// App initialization
import formbricks from "@formbricks/js";

formbricks.setup({
  environmentId: "clx123abc",
  appUrl: "https://app.formbricks.com"
});

formbricks.setUserId("user_789");
formbricks.setAttribute("plan", "pro");
```

**What happens:**
1. SDK fetches environment config (surveys, action classes, project settings)
2. Stores in localStorage for offline support
3. Sets up event listeners for no-code actions

### 2. User Triggers Survey

```javascript
// User completes onboarding
formbricks.track("onboarding_completed");
```

**SDK evaluation:**
1. Find surveys with `onboarding_completed` trigger
2. Filter by segment (check attributes)
3. Apply display rules (recontact days, display limit)
4. Render eligible survey in widget

### 3. Response Collection

User answers questions → SDK sends:

```typescript
POST /api/v1/client/responses
{
  surveyId: "clx456def",
  data: {
    "q1": "Yes, very helpful",
    "q2": 9
  },
  variables: {
    "nps_category": "Promoter"
  },
  finished: true
}
```

### 4. Pipeline Processing

**Endpoint:** `/api/(internal)/pipeline`

```typescript
// Pseudo-code of pipeline
const pipeline = async (response: Response) => {
  // 1. Validate and save response
  await saveResponse(response);
  
  // 2. Trigger integrations (parallel)
  await Promise.all([
    sendToSlack(response),
    updateGoogleSheet(response),
    callWebhooks(response)
  ]);
  
  // 3. Send email notifications
  if (survey.emailNotifications) {
    await sendNotificationEmail(response);
  }
  
  // 4. Generate follow-up surveys
  await evaluateFollowUpLogic(response);
};
```

---

## Architectural Patterns in Action

### 1. Service Layer Pattern

```typescript
// apps/web/lib/survey/service.ts
import "server-only"; // Compile error if imported in client

export const getSurvey = reactCache(
  async (surveyId: string): Promise<TSurvey | null> => {
    // Input validation
    validateInputs([surveyId, ZId]);
    
    // Database query
    const survey = await prisma.survey.findUnique({
      where: { id: surveyId },
      select: selectSurvey
    });
    
    if (!survey) return null;
    
    // Transform Prisma type to domain type
    return transformPrismaSurvey(survey);
  }
);
```

**Why this pattern?**
- **Separation of concerns** - Database logic separate from API/UI
- **Reusability** - Used by API routes, server actions, and server components
- **Caching** - `reactCache` deduplicates calls in single request
- **Type safety** - Input/output types explicit

### 2. Result Type for Graceful Degradation

```typescript
// packages/cache/src/service.ts
type Result<T, E> = 
  | { ok: true; data: T } 
  | { ok: false; error: E };

export class CacheService {
  async get<T>(key: string): Promise<Result<T | null, CacheError>> {
    try {
      if (!this.isRedisReady()) {
        return err({ code: "RedisConnectionError" });
      }
      
      const value = await this.redis.get(key);
      return ok(value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error({ error, key }, "Cache get failed");
      return err({ code: "Unknown" });
    }
  }
}

// Usage: Never throws, gracefully degrades
const result = await cache.get("survey:123");
if (result.ok && result.data) {
  return result.data;
}
// Fallback: fetch from database
return await fetchFromDatabase();
```

**Why Result type?**
- Cache failures shouldn't break the app
- Forces explicit error handling
- No try/catch blocks everywhere

### 3. Server Actions for Mutations

```typescript
// apps/web/modules/survey/editor/actions.ts
export const updateSurveyAction = authenticatedActionClient
  .schema(ZUpdateSurveyInput)
  .action(async ({ ctx, parsedInput }) => {
    // Authorization check
    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: await getOrganizationIdFromSurveyId(parsedInput.surveyId),
      access: [
        { type: "organization", roles: ["owner", "manager"] },
        { type: "projectTeam", minPermission: "readWrite" }
      ]
    });
    
    // Business logic
    const survey = await updateSurvey(parsedInput);
    
    // Audit log (Enterprise Edition)
    if (ctx.auditLoggingCtx) {
      await logAuditEvent({
        action: "updated",
        targetType: "survey",
        targetId: survey.id,
        oldObject: ctx.auditLoggingCtx.oldObject,
        newObject: survey
      });
    }
    
    // Cache invalidation
    await invalidateSurveyCache(survey.id);
    
    return survey;
  });
```

**Benefits:**
- Type-safe client → server calls
- Centralized auth/validation
- Audit logging built-in
- Error handling automatic

---

## Key Architectural Decisions: The Tradeoffs

### Decision 1: Preact for Survey Rendering

**Problem:** Surveys need to load fast on any website.

**Options:**
1. React (~100KB) - Full ecosystem, heavy
2. Preact (~4KB) - React-like, lightweight
3. Vanilla JS - Smallest, no framework help

**Choice:** Preact

**Tradeoff:**
- ✅ 95% smaller than React
- ✅ React-compatible (JSX, hooks)
- ❌ Smaller ecosystem
- ❌ Some React libraries incompatible

**Validation:** Survey package bundles to ~150KB total (with i18n), ~60KB gzipped. Acceptable for inline widgets.

### Decision 2: Single Encryption Key

**Current:** One `ENCRYPTION_KEY` for all encrypted data (2FA secrets, email tokens, etc.)

**Alternatives:**
1. Per-user encryption keys
2. Key derivation per data type
3. Hardware security module (HSM)

**Tradeoff:**
- ✅ Simple key management
- ✅ Fast encryption/decryption
- ❌ Single point of failure
- ❌ No key rotation mechanism

**Future:** RFC needed for key versioning and rotation.

### Decision 3: Redis Optional

**Pattern:** Redis failures don't break the app.

```typescript
const cacheResult = await cache.get("key");
if (cacheResult.ok) {
  return cacheResult.data;
}
// Fallback: database
return await fetchFromDB();
```

**Tradeoff:**
- ✅ Resilient to Redis outages
- ✅ Works without Redis (test environments)
- ❌ Some features degraded (audit logs, rate limiting)

**Why:** For self-hosters, Redis is an extra dependency. Making it optional lowers the barrier to entry.

---

## What We've Learned

1. **Modular monolith is a valid choice** for most applications. Microservices add complexity without proportional benefits for Formbricks's use case.

2. **Type safety everywhere** (TypeScript + Zod + Prisma) prevents entire classes of bugs. The compile-time investment pays off at runtime.

3. **Graceful degradation** (Result types, optional Redis) makes the system resilient. Not every failure needs to cascade.

4. **Server Components** shift complexity to the server, reducing client bundle size and improving performance.

5. **Clear domain model** (Organization → Project → Environment → Survey) provides structure for multi-tenancy without confusion.

---

## Next in the Series

In **Part 2**, we'll dive deep into the **Survey Engine**—how Formbricks renders 15 different question types, evaluates complex logic, and keeps bundle size under control.

**Coming up:**
- Survey rendering architecture (why Preact?)
- Question type implementations
- Logic evaluation engine
- Variable calculations
- Performance optimizations

---

## Further Reading

- [Formbricks GitHub](https://github.com/formbricks/formbricks/tree/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)
- [Next.js App Router Docs](https://nextjs.org/docs/app)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Martin Fowler on Modular Monoliths](https://martinfowler.com/articles/dont-start-monolith.html)

---

*This analysis is based on commit `341e263`. All code examples link to specific lines in the repository for reference.*
