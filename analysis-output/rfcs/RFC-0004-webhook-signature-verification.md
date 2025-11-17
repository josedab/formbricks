# RFC-0004: Webhook Signature Verification

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** High (Quick Win)  
**Effort:** 1 week

## Summary

Implement HMAC-SHA256 signature verification for outbound webhooks to allow webhook consumers to validate that payloads originated from Formbricks and haven't been tampered with.

## Motivation

**Current State:**
- Webhooks send JSON payloads to user-defined URLs
- No signature or authentication mechanism
- Recipients cannot verify payload authenticity
- Vulnerable to replay attacks and man-in-the-middle tampering

**Problems:**
1. **Trust Issue:** Recipients can't verify the webhook came from Formbricks
2. **Security Risk:** Attackers could forge webhook payloads
3. **Compliance:** Many security standards require webhook signing
4. **Industry Standard:** Most modern webhook systems use HMAC signatures (Stripe, GitHub, Slack)

**Attack Scenarios:**
- Attacker intercepts webhook, modifies response data
- Attacker replays old webhook payloads
- Attacker sends fake webhooks to trigger actions

## Detailed Design

### Signature Generation

**Algorithm:** HMAC-SHA256

```typescript
// apps/web/lib/webhooks/signature.ts
import crypto from "crypto";

export function generateWebhookSignature(
  payload: string,
  secret: string,
  timestamp: number
): string {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  
  return `sha256=${signature}`;
}

// Example usage
const payload = JSON.stringify(webhookData);
const timestamp = Math.floor(Date.now() / 1000);
const signature = generateWebhookSignature(payload, webhook.secret, timestamp);

// HTTP Headers sent with webhook
headers: {
  "X-Formbricks-Signature": signature,
  "X-Formbricks-Timestamp": timestamp.toString(),
  "X-Formbricks-Webhook-Id": webhook.id
}
```

### Webhook Secret Management

**Database Schema Update:**
```prisma
model Webhook {
  id            String   @id @default(cuid())
  url           String
  name          String?
  secret        String   // Auto-generated on creation
  triggers      PipelineTriggers[]
  surveyIds     String[]
  
  // New fields
  signatureEnabled Boolean @default(true)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

**Secret Generation:**
```typescript
import crypto from "crypto";

export function generateWebhookSecret(): string {
  // Generate 32-byte random secret, base64url encoded
  return crypto.randomBytes(32).toString("base64url");
}

// On webhook creation
const webhook = await prisma.webhook.create({
  data: {
    url: input.url,
    secret: generateWebhookSecret(),
    signatureEnabled: true,
    ...
  }
});
```

### Webhook Delivery Implementation

```typescript
// apps/web/app/api/(internal)/pipeline/lib/webhook-delivery.ts
export async function deliverWebhook(
  webhook: Webhook,
  event: PipelineTrigger,
  payload: WebhookPayload
): Promise<WebhookDeliveryResult> {
  const timestamp = Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify(payload);
  
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Formbricks-Webhook/1.0",
    "X-Formbricks-Event": event,
    "X-Formbricks-Webhook-Id": webhook.id,
  };
  
  // Add signature if enabled
  if (webhook.signatureEnabled) {
    const signature = generateWebhookSignature(
      payloadString,
      webhook.secret,
      timestamp
    );
    headers["X-Formbricks-Signature"] = signature;
    headers["X-Formbricks-Timestamp"] = timestamp.toString();
  }
  
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body: payloadString,
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });
    
    return {
      success: response.ok,
      statusCode: response.status,
      deliveredAt: new Date(),
    };
  } catch (error) {
    logger.error({ error, webhookId: webhook.id }, "Webhook delivery failed");
    return {
      success: false,
      error: error.message,
      deliveredAt: new Date(),
    };
  }
}
```

### Consumer Verification (Documentation)

**Verification Example (Node.js):**
```javascript
// Example for webhook consumers
const crypto = require("crypto");

function verifyWebhookSignature(payload, signature, secret, timestamp) {
  // 1. Check timestamp freshness (prevent replay attacks)
  const currentTime = Math.floor(Date.now() / 1000);
  const timeDifference = Math.abs(currentTime - timestamp);
  
  if (timeDifference > 300) { // 5 minutes
    throw new Error("Webhook timestamp too old");
  }
  
  // 2. Reconstruct signed payload
  const signedPayload = `${timestamp}.${payload}`;
  
  // 3. Compute expected signature
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  
  // 4. Compare signatures (constant-time to prevent timing attacks)
  const providedSignature = signature.replace("sha256=", "");
  
  if (!crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(providedSignature)
  )) {
    throw new Error("Invalid signature");
  }
  
  return true;
}

// Express.js webhook endpoint example
app.post("/webhooks/formbricks", (req, res) => {
  const signature = req.headers["x-formbricks-signature"];
  const timestamp = parseInt(req.headers["x-formbricks-timestamp"]);
  const payload = JSON.stringify(req.body);
  const secret = process.env.FORMBRICKS_WEBHOOK_SECRET;
  
  try {
    verifyWebhookSignature(payload, signature, secret, timestamp);
    
    // Signature valid - process webhook
    console.log("Valid webhook:", req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error("Invalid webhook signature:", error);
    res.sendStatus(401);
  }
});
```

### UI/UX Changes

**Webhook Creation Flow:**
1. User creates webhook with URL
2. System generates and displays secret (show once)
3. User copies secret to their webhook handler
4. Optional: Download verification code snippet

**Webhook Details Page:**
```typescript
// Display webhook secret (masked by default)
<div>
  <label>Webhook Secret</label>
  <div className="flex items-center gap-2">
    <Input 
      type={showSecret ? "text" : "password"}
      value={webhook.secret}
      readOnly
    />
    <Button onClick={() => setShowSecret(!showSecret)}>
      {showSecret ? "Hide" : "Show"}
    </Button>
    <Button onClick={copyToClipboard}>Copy</Button>
  </div>
  
  <Button onClick={regenerateSecret}>
    Regenerate Secret
  </Button>
  
  <Alert>
    <AlertTitle>Important</AlertTitle>
    <AlertDescription>
      Store this secret securely. It's used to verify webhook authenticity.
    </AlertDescription>
  </Alert>
</div>
```

**Secret Regeneration:**
```typescript
export const regenerateWebhookSecretAction = authenticatedActionClient
  .schema(z.object({ webhookId: z.string() }))
  .action(async ({ ctx, parsedInput }) => {
    await checkAuthorizationUpdated({
      userId: ctx.user.id,
      organizationId: await getOrganizationIdFromWebhookId(parsedInput.webhookId),
      access: [{ type: "organization", roles: ["owner", "manager"] }]
    });
    
    const newSecret = generateWebhookSecret();
    
    const webhook = await prisma.webhook.update({
      where: { id: parsedInput.webhookId },
      data: { 
        secret: newSecret,
        updatedAt: new Date()
      }
    });
    
    // Log regeneration for audit
    logger.audit({
      action: "webhook_secret_regenerated",
      webhookId: webhook.id,
      userId: ctx.user.id
    });
    
    return { secret: newSecret };
  });
```

### Webhook Testing Endpoint

```typescript
// Test webhook with signature
export async function POST(req: Request) {
  const { webhookId } = await req.json();
  
  const webhook = await getWebhook(webhookId);
  
  const testPayload = {
    event: "test",
    data: {
      message: "This is a test webhook",
      timestamp: new Date().toISOString()
    }
  };
  
  const result = await deliverWebhook(
    webhook,
    "test",
    testPayload
  );
  
  return Response.json(result);
}
```

## Implementation Plan

**Week 1:**
- [ ] Day 1-2: Implement signature generation
  - Create signature utility functions
  - Add unit tests for signature generation
  - Test with known test vectors
  
- [ ] Day 3-4: Database and API updates
  - Add `secret` field to Webhook model
  - Create migration to backfill secrets for existing webhooks
  - Update webhook creation API
  - Update webhook delivery to include signatures
  
- [ ] Day 5: UI/UX implementation
  - Webhook secret display/copy
  - Secret regeneration flow
  - Verification code examples
  
- [ ] Day 6: Documentation
  - Webhook signature verification guide
  - Code examples for popular languages (Node.js, Python, Go)
  - Migration guide for existing webhook consumers
  
- [ ] Day 7: Testing and deployment
  - Integration tests
  - Test with real webhook consumers
  - Deploy to staging, then production

## Example Usage

**Creating Webhook (API):**
```typescript
POST /api/v2/management/webhooks
{
  "url": "https://example.com/webhooks",
  "triggers": ["responseFinished"],
  "surveyIds": []
}

// Response
{
  "id": "clx123",
  "url": "https://example.com/webhooks",
  "secret": "whsec_K9Xv8jZp2nQ5rY3wH7mL4tF6gC8bN1dS",
  "signatureEnabled": true,
  ...
}
```

**Webhook Payload Sent:**
```http
POST https://example.com/webhooks
Content-Type: application/json
X-Formbricks-Signature: sha256=a7f8d9e6b5c4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8
X-Formbricks-Timestamp: 1700000000
X-Formbricks-Event: responseFinished
X-Formbricks-Webhook-Id: clx123

{
  "event": "responseFinished",
  "data": {
    "response": { ... },
    "survey": { ... }
  }
}
```

## Backwards Compatibility

**Existing Webhooks:**
- Auto-generate secrets for existing webhooks
- `signatureEnabled` defaults to `true` for new webhooks
- Existing webhooks: `signatureEnabled` = `false` initially
- Provide migration period (30 days) with notification
- After migration period, enable signatures for all

**Migration Email:**
```
Subject: Action Required: Webhook Signature Verification

We're enhancing webhook security with HMAC-SHA256 signatures.

What you need to do:
1. Update your webhook handler to verify signatures
2. Use the secret from your webhook settings
3. See our verification guide: [link]

Timeline:
- Now: Signatures sent but not required
- Jan 15, 2026: Signatures required (unsigned webhooks rejected)

Your webhook secret: [View in Dashboard]
```

## Alternatives Considered

### Alternative 1: JWT Tokens
**Pros:** Standard format, includes expiry
**Cons:** More complex, larger payload, overkill for webhooks
**Decision:** HMAC is simpler and industry standard

### Alternative 2: API Key in Header
**Pros:** Simple
**Cons:** No payload integrity verification, replayable
**Decision:** Doesn't prevent tampering

### Alternative 3: Mutual TLS
**Pros:** Strong authentication
**Cons:** Complex setup, certificate management
**Decision:** Too complex for webhook consumers

## Security Considerations

1. **Secret Storage:**
   - Store in database (already encrypted at rest)
   - Never log secrets
   - Mask in UI by default

2. **Timing Attacks:**
   - Use constant-time comparison for signature verification
   - Example code uses `crypto.timingSafeEqual()`

3. **Replay Attacks:**
   - Include timestamp in signature
   - Reject old timestamps (>5 minutes)
   - Recipients should track processed webhook IDs

4. **Secret Rotation:**
   - Allow regeneration of secrets
   - Provide grace period for updates
   - Notify on regeneration

## Success Criteria

- [ ] All new webhooks have auto-generated secrets
- [ ] Signatures included in all webhook deliveries
- [ ] Verification examples in 3+ languages (Node.js, Python, Go)
- [ ] Migration guide for existing webhook consumers
- [ ] <1% delivery failure rate due to signature issues
- [ ] Documentation published and clear

## Documentation

**Required Documentation:**
1. Webhook signature verification guide
2. Code examples (Node.js, Python, Go, PHP)
3. Migration guide for existing consumers
4. Troubleshooting guide
5. Security best practices

## Estimated Impact

- **Security:** High - Prevents webhook spoofing and tampering
- **User Impact:** Medium - Requires code changes for consumers
- **Development Effort:** 1 week
- **Maintenance:** Low - Standard HMAC implementation

## References

- [Stripe Webhook Signatures](https://stripe.com/docs/webhooks/signatures)
- [GitHub Webhook Signatures](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [HMAC-SHA256 Specification (RFC 2104)](https://tools.ietf.org/html/rfc2104)
