# Extending and Integrating Formbricks

**Part 4 of 7 - Formbricks Technical Deep Dive**
**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## What You'll Learn

- JavaScript SDK architecture and API
- Webhook system design
- Built-in integrations (Slack, Notion, Google Sheets)
- API design (v1 vs v2)
- Extension points and customization

## JavaScript SDK Architecture

**Package:** `@formbricks/js-core`

**Core API:**
```javascript
// Initialize
formbricks.setup({
  environmentId: "clx123",
  appUrl: "https://app.formbricks.com"
});

// Identify user
formbricks.setUserId("user_789");
formbricks.setAttribute("plan", "pro");
formbricks.setAttribute("company", "Acme Corp");

// Track events
formbricks.track("onboarding_completed");
formbricks.track("feature_used", { feature: "export" });

// Cleanup
formbricks.logout();
```

**Command Queue Pattern:**

Handles async operations and race conditions:

```typescript
class CommandQueue {
  private queue: Command[] = [];
  private isProcessing = false;
  
  async add(command: Command) {
    this.queue.push(command);
    if (!this.isProcessing) {
      await this.process();
    }
  }
  
  private async process() {
    this.isProcessing = true;
    while (this.queue.length > 0) {
      const command = this.queue.shift()!;
      await this.execute(command);
    }
    this.isProcessing = false;
  }
}
```

**Benefit:** Prevents race conditions when multiple `track()` calls happen rapidly.

## Webhook System

**Event Types:**
- `responseCreated` - Partial response saved
- `responseUpdated` - Response modified
- `responseFinished` - Survey completed

**Payload Structure:**
```typescript
POST https://your-webhook-url.com
Content-Type: application/json

{
  "event": "responseFinished",
  "data": {
    "response": {
      "id": "resp_123",
      "surveyId": "survey_456",
      "data": { "q1": "Great product!", "q2": 9 },
      "finished": true,
      "createdAt": "2025-11-16T10:30:00Z"
    },
    "survey": {
      "id": "survey_456",
      "name": "Customer Satisfaction",
      ...
    },
    "contact": {
      "userId": "user_789",
      "attributes": { "plan": "pro" }
    }
  }
}
```

**Processing Pipeline:**

```typescript
// apps/web/app/api/(internal)/pipeline/route.ts
export async function POST(req: Request) {
  const { event, response, survey } = await req.json();
  
  // 1. Get matching webhooks
  const webhooks = await prisma.webhook.findMany({
    where: {
      environmentId: survey.environmentId,
      triggers: { has: event }
    }
  });
  
  // 2. Dispatch in parallel
  const results = await Promise.allSettled([
    ...webhooks.map(w => deliverWebhook(w, event, response)),
    sendToIntegrations(survey, response),
    sendEmailNotifications(survey, response)
  ]);
  
  return Response.json({ success: true });
}
```

## Built-in Integrations

### Slack Integration

**OAuth Flow:**
```typescript
// 1. User clicks "Connect Slack"
// 2. Redirect to Slack OAuth
const authUrl = `https://slack.com/oauth/v2/authorize?` +
  `client_id=${SLACK_CLIENT_ID}&` +
  `scope=chat:write,incoming-webhook&` +
  `redirect_uri=${WEBAPP_URL}/api/v1/integrations/slack/callback`;

// 3. Callback receives code
export async function GET(req: Request) {
  const { code } = parseQuery(req.url);
  
  // Exchange code for access token
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    body: new URLSearchParams({
      code,
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET
    })
  });
  
  const { access_token, incoming_webhook } = await response.json();
  
  // Store integration
  await prisma.integration.create({
    data: {
      type: "slack",
      config: {
        webhookUrl: incoming_webhook.url,
        channel: incoming_webhook.channel
      },
      environmentId
    }
  });
}

// 4. On response, send to Slack
async function sendToSlack(integration, response) {
  await fetch(integration.config.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `New survey response from ${response.contact?.userId}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: formatResponse(response) }
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "View Response" },
              url: `${WEBAPP_URL}/responses/${response.id}`
            }
          ]
        }
      ]
    })
  });
}
```

### Google Sheets Integration

**Append Row on Response:**
```typescript
import { google } from "googleapis";

async function appendToSheet(integration, response, survey) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: integration.config.accessToken });
  
  const sheets = google.sheets({ version: "v4", auth });
  
  // Prepare row data
  const headers = ["Timestamp", "Survey", ...survey.questions.map(q => q.headline.default)];
  const values = [
    new Date().toISOString(),
    survey.name,
    ...survey.questions.map(q => response.data[q.id] || "")
  ];
  
  await sheets.spreadsheets.values.append({
    spreadsheetId: integration.config.spreadsheetId,
    range: "A1",
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [values] }
  });
}
```

## API Design

### v1 API (Legacy)

**Structure:**
```
/api/v1/
  /client/          # SDK endpoints (public)
  /management/      # CRUD operations (API key required)
  /integrations/    # OAuth callbacks
```

**Example:**
```typescript
GET /api/v1/management/surveys/{surveyId}
Headers:
  x-api-key: fbk_...

Response:
{
  "data": { ... survey object ... }
}
```

### v2 API (Modern)

**Improvements:**
- Better error responses
- Consistent pagination
- OpenAPI spec
- Webhook signatures (planned)

**Pagination:**
```typescript
GET /api/v2/management/surveys?page=1&limit=50

Response:
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "hasMore": true
  }
}
```

## Extension Points

### 1. Custom Question Types

Add to `packages/surveys/src/components/questions/`:

```typescript
export function CustomQuestion({ question, value, onChange }: Props) {
  // Your custom logic
  return <div>...</div>;
}

// Register in Survey component
const questionComponents = {
  openText: OpenTextQuestion,
  nps: NPSQuestion,
  custom: CustomQuestion  // Add here
};
```

### 2. Custom Integrations

```typescript
// Create integration handler
export async function handleCustomIntegration(
  integration: TIntegration,
  response: TResponse
) {
  await fetch(integration.config.webhookUrl, {
    method: "POST",
    body: JSON.stringify({
      response,
      customField: integration.config.customField
    })
  });
}

// Register in pipeline
const integrationHandlers = {
  slack: handleSlackIntegration,
  notion: handleNotionIntegration,
  custom: handleCustomIntegration  // Add here
};
```

### 3. Custom Survey Templates

```typescript
// apps/web/lib/templates.ts
export const customTemplate: TSurveyTemplate = {
  name: "Custom Feedback",
  description: "Our custom survey flow",
  questions: [
    {
      type: "rating",
      headline: { default: "Rate us!" }
    },
    {
      type: "openText",
      headline: { default: "Tell us more" }
    }
  ],
  logic: [...]
};
```

## Real-World Integration Examples

### Zapier Integration

**Trigger:** New Response
**Actions:** Create task in Asana, send email, update CRM

```javascript
// Zapier webhook
POST https://hooks.zapier.com/hooks/catch/...
{
  "event": "responseFinished",
  "survey_name": "Customer Satisfaction",
  "response_data": {...},
  "contact_email": "user@example.com"
}
```

### Make (Integromat)

**Scenario:** Response → Filter by NPS → Route to different actions

### n8n Workflow

**Self-hosted automation:**
```json
{
  "nodes": [
    { "type": "webhook", "name": "Formbricks Response" },
    { "type": "switch", "name": "Route by NPS", "rules": [...] },
    { "type": "slack", "name": "Alert Team" },
    { "type": "airtable", "name": "Log to Database" }
  ]
}
```

## Key Takeaways

1. **SDK is lightweight** - Command queue prevents race conditions
2. **Webhooks are powerful** - Event-driven architecture enables unlimited integrations
3. **OAuth integrations** - Standard patterns for Slack, Google, etc.
4. **API versioning** - v2 improves on v1 lessons learned
5. **Extension points** - Custom questions, integrations, templates all supported

Next: **Part 5 - Performance Analysis and Optimization**
