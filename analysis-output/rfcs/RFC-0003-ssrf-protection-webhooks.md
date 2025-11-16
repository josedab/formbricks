# RFC-0003: SSRF Protection for Webhooks

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Critical (Quick Win)  
**Effort:** 2 hours

## Summary

Add Server-Side Request Forgery (SSRF) protection to webhook URLs to prevent attackers from using Formbricks to scan internal networks or access cloud metadata endpoints.

## Motivation

**Current State:**
- Webhooks accept any URL
- No validation against private IP ranges
- No check for localhost/metadata endpoints

**Attack Scenario:**
```typescript
// Attacker creates webhook
POST /api/v2/management/webhooks
{
  "url": "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
  "triggers": ["responseFinished"]
}

// Formbricks server makes request to AWS metadata endpoint
// → Credentials leaked in response
```

**Vulnerable Endpoints:**
- `169.254.169.254` - AWS/GCP/Azure metadata
- `127.0.0.1` - localhost services
- `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` - Private networks

## Detailed Design

### URL Validation Function

```typescript
// apps/web/lib/utils/ssrf-protection.ts
import { isPrivateIp } from "is-private-ip";
import dns from "dns/promises";

export class SSRFProtectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFProtectionError";
  }
}

export async function validateWebhookUrl(url: string): Promise<void> {
  // 1. Parse URL
  const parsed = new URL(url);
  
  // 2. Block non-HTTP protocols
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SSRFProtectionError(
      `Protocol ${parsed.protocol} not allowed. Use http: or https:`
    );
  }
  
  // 3. Block localhost
  if (["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(parsed.hostname)) {
    throw new SSRFProtectionError("Localhost URLs are not allowed");
  }
  
  // 4. Resolve DNS
  let ips: string[];
  try {
    ips = await dns.resolve4(parsed.hostname);
  } catch (error) {
    try {
      ips = await dns.resolve6(parsed.hostname);
    } catch {
      throw new SSRFProtectionError(`Could not resolve hostname: ${parsed.hostname}`);
    }
  }
  
  // 5. Check each IP
  for (const ip of ips) {
    if (isPrivateIp(ip)) {
      throw new SSRFProtectionError(
        `URL resolves to private IP address: ${ip}`
      );
    }
    
    // Check cloud metadata IPs
    if (ip.startsWith("169.254.")) {
      throw new SSRFProtectionError(
        `URL resolves to link-local address: ${ip}`
      );
    }
  }
  
  // 6. Additional checks
  if (parsed.hostname === "metadata.google.internal") {
    throw new SSRFProtectionError("Google Cloud metadata endpoint not allowed");
  }
}
```

### Integration Points

**1. Webhook Creation:**
```typescript
// apps/web/app/api/v2/management/webhooks/route.ts
export async function POST(req: Request) {
  const body = await req.json();
  
  // Validate URL before saving
  try {
    await validateWebhookUrl(body.url);
  } catch (error) {
    if (error instanceof SSRFProtectionError) {
      return Response.json(
        { error: error.message },
        { status: 400 }
      );
    }
    throw error;
  }
  
  // Continue with webhook creation
  const webhook = await createWebhook(body);
  return Response.json(webhook);
}
```

**2. Webhook Updates:**
```typescript
export async function PATCH(req: Request) {
  // Same validation
  await validateWebhookUrl(newUrl);
}
```

**3. Webhook Testing:**
```typescript
// Test endpoint also validates
export async function POST(req: Request) {
  await validateWebhookUrl(testUrl);
  // Send test payload
}
```

### Allow list for Known Services

```typescript
// For trusted services that may use private IPs
const WEBHOOK_ALLOWLIST = [
  "hooks.slack.com",
  "discord.com"
];

function isAllowlisted(hostname: string): boolean {
  return WEBHOOK_ALLOWLIST.some(domain => hostname.endsWith(domain));
}
```

## Implementation Plan

**Hour 1:**
- [ ] Implement `validateWebhookUrl()` function
- [ ] Add `is-private-ip` dependency
- [ ] Write unit tests

**Hour 2:**
- [ ] Integrate validation into webhook routes
- [ ] Test with various URLs (localhost, private IPs, cloud metadata)
- [ ] Update API documentation
- [ ] Add migration for existing webhooks (validate and mark invalid ones)

## Backwards Compatibility

**Existing Webhooks:**
- Run validation job on all existing webhooks
- Mark invalid webhooks as `disabled` with reason
- Notify webhook owners via email
- Provide grace period (30 days) to update

## Success Criteria

- [ ] Cannot create webhook pointing to localhost
- [ ] Cannot create webhook pointing to private IPs
- [ ] Cannot create webhook pointing to cloud metadata
- [ ] Existing webhooks validated
- [ ] Tests cover all edge cases

## Testing

```typescript
// __tests__/ssrf-protection.test.ts
describe("validateWebhookUrl", () => {
  it("allows public HTTPS URLs", async () => {
    await expect(validateWebhookUrl("https://example.com/webhook"))
      .resolves.not.toThrow();
  });
  
  it("blocks localhost", async () => {
    await expect(validateWebhookUrl("http://localhost/webhook"))
      .rejects.toThrow(SSRFProtectionError);
  });
  
  it("blocks private IPs", async () => {
    await expect(validateWebhookUrl("http://192.168.1.1/webhook"))
      .rejects.toThrow(SSRFProtectionError);
  });
  
  it("blocks cloud metadata", async () => {
    await expect(validateWebhookUrl("http://169.254.169.254/"))
      .rejects.toThrow(SSRFProtectionError);
  });
  
  it("allows allowlisted domains", async () => {
    await expect(validateWebhookUrl("https://hooks.slack.com/services/..."))
      .resolves.not.toThrow();
  });
});
```

## Security Impact

- **High:** Prevents SSRF attacks
- **Medium:** Protects internal services
- **Low:** May inconvenience users with legitimate local webhooks (rare)

## Estimated Impact

- **Security:** Critical - Prevents serious vulnerability
- **User Impact:** Minimal - Most webhooks are external
- **Development Effort:** 2 hours
- **Maintenance:** Low

