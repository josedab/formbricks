# Formbricks Terminology Glossary

**Analysis Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

---

## Purpose

This glossary defines Formbricks-specific terms, acronyms, and concepts used throughout the codebase and documentation.

---

## Core Concepts

### Action Class
**Definition:** A trigger definition that determines when surveys should be displayed to users.

**Types:**
- **Code Action:** Triggered via `formbricks.track("action_name")`
- **No-Code Action:** Triggered automatically based on:
  - Click events (CSS selectors, innerHTML matching)
  - Page views (URL patterns)
  - Exit intent (mouse leave)
  - Scroll depth (50% scroll)

**Example:**
```typescript
{
  id: "clx123",
  name: "Feature Completed",
  type: "code",
  environmentId: "clx456"
}
```

### Contact
**Definition:** A tracked user in the Formbricks system, identified by userId and optionally linked to survey responses.

**Attributes:**
- Custom attributes (e.g., plan, role, company)
- System attributes (createdAt, updatedAt)
- Contact attribute keys define available attributes

**Relationship:**
```
Contact → ContactAttribute → ContactAttributeKey
```

### Display
**Definition:** A record of when a survey was shown to a contact, used for tracking display rules and analytics.

**Display Rules:**
- `displayOnce` - Show survey only once per contact
- `displayMultiple` - Show every time conditions met
- `displaySome` - Limit number of displays
- `respondMultiple` - Allow multiple responses

### Environment
**Definition:** A deployment context (production, development, staging) within a Project, providing isolation for surveys, contacts, and responses.

**Hierarchy:**
```
Organization → Project → Environment
```

**Purpose:**
- Separate test data from production
- Different API keys per environment
- Independent survey configurations

### Segment
**Definition:** A user cohort defined by filters on contact attributes and actions, used for survey targeting.

**Example:**
```typescript
{
  title: "Power Users",
  filters: [
    { type: "attribute", key: "plan", operator: "equals", value: "pro" },
    { connector: "and", type: "attribute", key: "loginCount", operator: "greaterThan", value: 10 }
  ]
}
```

### Survey
**Definition:** A questionnaire consisting of questions, logic, styling, and targeting rules.

**States:**
- `draft` - Being edited, not visible to users
- `inProgress` - Active and displayable
- `paused` - Temporarily disabled
- `completed` - Finished collecting responses

**Types:**
- `link` - Shareable URL survey
- `app` - In-app widget survey

### Response
**Definition:** A user's submission to a survey, containing answers, metadata, and completion status.

**Fields:**
- `data` - Question answers (JSON)
- `variables` - Calculated variable values (JSON)
- `ttc` - Time-to-complete per question (JSON)
- `meta` - Browser, device, location metadata
- `finished` - Boolean completion status
- `contactAttributes` - Snapshot of contact attributes at response time

---

## Technical Terms

### Action Client
**Definition:** A Next.js server action wrapper providing authentication, authorization, and error handling.

**Types:**
- `actionClient` - Base client with error handling
- `authenticatedActionClient` - Requires user session
- `organizationActionClient` - Requires organization access

**Usage:**
```typescript
export const updateSurveyAction = authenticatedActionClient
  .schema(ZUpdateSurveyInput)
  .action(async ({ ctx, parsedInput }) => {
    // Implementation
  });
```

### Contact Attribute Key
**Definition:** A schema definition for contact attributes, specifying the key name, type, and uniqueness constraints.

**Types:**
- `default` - System-defined (userId, email, language)
- `custom` - User-defined attributes

**Example:**
```typescript
{
  key: "company",
  name: "Company Name",
  type: "custom",
  isUnique: false
}
```

### CUID
**Definition:** Collision-resistant Unique Identifier, used for generating IDs in Formbricks.

**Library:** `@paralleldrive/cuid2`

**Format:** `clx123abc...` (25 characters)

**Usage:**
- Survey IDs
- Response IDs
- Organization IDs
- All database entity IDs

### Display Logic
**Definition:** Rules determining survey eligibility based on display history, recontact periods, and targeting.

**Components:**
- Recontact days - Minimum days between displays
- Display limit - Maximum times to show
- Response limit - Maximum responses per contact

### EE (Enterprise Edition)
**Definition:** Licensed features requiring an enterprise license key or Formbricks Cloud subscription.

**Location:** `/apps/web/modules/ee/`

**Features:**
- SSO/SAML
- Audit logs
- Teams and RBAC
- Multi-language surveys
- Response quotas
- White-labeling
- Advanced contact management

### End Screen
**Definition:** The final card shown after survey completion, can display a message or redirect URL.

**Types:**
- Message ending - Thank you message
- Redirect ending - Redirect to URL
- Hidden ending - No ending card (auto-close)

### Environment ID
**Definition:** Unique identifier for an environment, used in SDK initialization and API requests.

**Format:** CUID (e.g., `clx456def...`)

**Usage:**
```javascript
formbricks.setup({
  environmentId: "clx456def"
});
```

### Hidden Field
**Definition:** A survey field that doesn't display to users but captures data passed via URL parameters or SDK.

**Use Cases:**
- UTM parameters
- User IDs
- Campaign tracking
- A/B test variants

**Example:**
```javascript
formbricks.track("survey_shown", {
  campaign: "summer_2024",
  variant: "A"
});
```

### Integration
**Definition:** A connection to a third-party service for sending survey responses or other events.

**Built-in Integrations:**
- Google Sheets
- Airtable
- Notion
- Slack
- n8n

**Custom Integrations:**
- Webhooks
- Zapier
- Make (formerly Integromat)

### Jump Logic
**Definition:** Conditional survey flow that skips or jumps to specific questions based on answers.

**Example:**
```typescript
{
  condition: "if answer equals 'Yes'",
  destination: "questionId_123"  // Jump to this question
}
```

### Membership
**Definition:** A user's association with an organization, including their role and permissions.

**Roles:**
- `owner` - Full access, billing
- `manager` - Manage surveys, members
- `member` - Create surveys
- `billing` - Billing access only

### MIU (Monthly Identified Users)
**Definition:** Count of unique contacts (by userId) tracked per month, used for billing and quotas.

**Tracking:**
- Counted when `formbricks.setUserId()` called
- Reset monthly
- Quota-based limits in plans

### Multi-tenancy
**Definition:** Architecture allowing multiple isolated organizations to use the same Formbricks instance.

**Hierarchy:**
```
Organization (tenant) → Project → Environment
```

**Isolation:**
- Separate databases schemas (SAML only)
- Row-level security via organizationId
- API key scoping

### NPS (Net Promoter Score)
**Definition:** A survey question type asking "How likely are you to recommend?" on a 0-10 scale.

**Scoring:**
- 0-6: Detractors
- 7-8: Passives
- 9-10: Promoters
- **NPS = % Promoters - % Detractors**

### Organization
**Definition:** The top-level multi-tenant entity in Formbricks, containing projects, users, and billing information.

**Attributes:**
- Billing plan (free, startup, custom)
- Response limits
- Project limits
- White-label settings

### Pipeline
**Definition:** Event processing system that handles survey responses, triggers integrations, and sends notifications.

**Flow:**
```
Response → Pipeline → [Webhooks, Integrations, Emails, Follow-ups]
```

**Events:**
- `responseCreated`
- `responseUpdated`
- `responseFinished`

### PMF (Product-Market Fit)
**Definition:** A survey template asking "How would you feel if you could no longer use [product]?"

**Options:**
- Very disappointed
- Somewhat disappointed
- Not disappointed

**Benchmark:** >40% "Very disappointed" indicates strong PMF

### Project
**Definition:** A product or application within an organization, containing multiple environments.

**Use Case:**
- Company has multiple products
- Each product is a project
- Each project has prod/dev environments

### Quota
**Definition:** Response limits based on conditions, used to control survey distribution.

**Types:**
- Total response quota
- Quota per segment
- Quota per answer option

**Example:**
```typescript
{
  surveyId: "clx123",
  quota: 100,
  filters: [{ questionId: "q1", operator: "equals", value: "Yes" }]
}
```

### Recontact Days
**Definition:** Minimum number of days before showing the same survey to a contact again.

**Example:**
```typescript
{
  recontactDays: 30  // Don't show again for 30 days
}
```

### Survey Logic
**Definition:** Conditional rules that control survey flow, calculations, and requirements.

**Types:**
- Jump logic - Skip questions
- Calculate variables - Perform math
- Require answer - Make questions mandatory

### TI18nString
**Definition:** Internationalized string type supporting multiple languages.

**Format:**
```typescript
{
  default: "Hello",    // Required
  en: "Hello",
  de: "Hallo",
  es: "Hola"
}
```

### TTL (Time To Live)
**Definition:** Cache expiration time in seconds or milliseconds.

**Usage:**
- Redis cache entries
- Presigned URLs (S3)
- Session tokens

### Variable
**Definition:** A calculated value in surveys that can be used in logic, questions, or endings.

**Types:**
- `number` - Numeric calculations
- `text` - String concatenation

**Example:**
```typescript
{
  name: "score",
  type: "number",
  value: 0,
  calculation: { operator: "add", operand: 10 }
}
```

### Widget
**Definition:** The in-app survey display component injected by the JavaScript SDK.

**Display Modes:**
- Modal - Overlay dialog
- Inline - Embedded in page
- Slider - Side panel

---

## Architecture Terms

### Modular Monolith
**Definition:** Architecture pattern where code is organized into independent modules within a single deployable application.

**Benefits:**
- Simpler deployment
- Module boundaries
- Shared code easily accessible

### Monorepo
**Definition:** Single repository containing multiple packages and applications.

**Tools:**
- pnpm workspaces
- Turborepo for builds

**Structure:**
```
/apps - Applications
/packages - Shared libraries
```

### Result Type
**Definition:** Rust-inspired error handling pattern using `Result<T, E>` for operations that can fail.

**Example:**
```typescript
type Result<T, E> = 
  | { ok: true; data: T }
  | { ok: false; error: E };

const result = await getCacheValue("key");
if (result.ok) {
  console.log(result.data);
} else {
  console.error(result.error);
}
```

### Server Action
**Definition:** Next.js feature allowing server-side functions to be called directly from client components.

**Example:**
```typescript
// actions.ts
export const updateSurveyAction = async (surveyId: string, data: TSurvey) => {
  "use server";
  return await updateSurvey(surveyId, data);
};

// component.tsx
const handleUpdate = async () => {
  await updateSurveyAction(surveyId, surveyData);
};
```

### Service Layer
**Definition:** Business logic layer separating data access from API/UI layers.

**Pattern:**
```typescript
// service.ts
export const getSurvey = async (surveyId: string): Promise<TSurvey> => {
  const survey = await prisma.survey.findUnique({ where: { id: surveyId } });
  return transformPrismaSurvey(survey);
};
```

---

## Development Terms

### Turborepo
**Definition:** Build system for monorepos with caching and parallel execution.

**Features:**
- Task orchestration
- Remote caching
- Incremental builds

### Workspace
**Definition:** A package within the monorepo, managed by pnpm workspaces.

**Protocol:** `workspace:*` for internal dependencies

---

## Security Terms

### API Key
**Definition:** Authentication token for API access, scoped to organization or environment.

**Format:** `fbk_{secret}` (v2)

**Types:**
- Environment API key - Environment-specific access
- Organization API key - Organization-wide access

### Encryption Key
**Definition:** AES-256 key used for encrypting sensitive data.

**Usage:**
- Two-factor secrets
- Backup codes
- Email tokens
- User IDs in JWTs

**Configuration:** `ENCRYPTION_KEY` environment variable (32-byte hex)

### Rate Limiting
**Definition:** Restricting number of requests per time period to prevent abuse.

**Implementation:**
- Redis-based sliding window
- IP-based tracking
- Endpoint-specific limits

---

## Acronyms

| Acronym | Full Term | Description |
|---------|-----------|-------------|
| **API** | Application Programming Interface | Programmatic access to Formbricks |
| **AGPL** | Affero General Public License | Open source license |
| **CORS** | Cross-Origin Resource Sharing | Browser security mechanism |
| **CSP** | Content Security Policy | Security header |
| **CRUD** | Create, Read, Update, Delete | Basic operations |
| **CUID** | Collision-resistant Unique ID | ID generation algorithm |
| **E2E** | End-to-End | Full system testing |
| **EE** | Enterprise Edition | Licensed features |
| **GDPR** | General Data Protection Regulation | Privacy law |
| **HSTS** | HTTP Strict Transport Security | Security header |
| **JWT** | JSON Web Token | Authentication token format |
| **MIU** | Monthly Identified Users | Billing metric |
| **NPS** | Net Promoter Score | Survey metric |
| **ORM** | Object-Relational Mapping | Database abstraction |
| **PII** | Personally Identifiable Information | Sensitive data |
| **PMF** | Product-Market Fit | Business metric |
| **RBAC** | Role-Based Access Control | Authorization model |
| **RFC** | Request for Comments | Proposal document |
| **RSC** | React Server Components | React architecture |
| **SAML** | Security Assertion Markup Language | SSO protocol |
| **SDK** | Software Development Kit | Client library |
| **SSO** | Single Sign-On | Authentication method |
| **TTL** | Time To Live | Cache expiration |
| **UUID** | Universally Unique Identifier | ID format |
| **WCAG** | Web Content Accessibility Guidelines | Accessibility standard |
| **XSS** | Cross-Site Scripting | Security vulnerability |

---

## Naming Conventions

### Prefixes

- `T` - TypeScript type (e.g., `TSurvey`)
- `Z` - Zod schema (e.g., `ZSurvey`)
- `I` - Interface (rare, prefer types)
- `use` - React hook (e.g., `useSurvey`)
- `with` - Higher-order function (e.g., `withAuth`)

### Suffixes

- `Action` - Server action (e.g., `updateSurveyAction`)
- `Service` - Service class (e.g., `CacheService`)
- `Input` - Input type (e.g., `TSurveyCreateInput`)
- `Output` - Output type (e.g., `TSurveyOutput`)
- `Props` - Component props (e.g., `SurveyEditorProps`)

---

## Common File Names

| File Name | Purpose |
|-----------|---------|
| `actions.ts` | Server actions for a module |
| `service.ts` | Business logic layer |
| `utils.ts` | Utility functions |
| `types.ts` | TypeScript type definitions |
| `constants.ts` | Constant values |
| `schema.ts` | Zod validation schemas |
| `route.ts` | Next.js API route |
| `page.tsx` | Next.js page component |
| `layout.tsx` | Next.js layout component |
| `middleware.ts` | Next.js middleware |

---

*This glossary is a living document. Suggest additions or corrections via pull request.*
