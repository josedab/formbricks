# RFC-0010: CSP Nonce Implementation

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Low (Long-term)  
**Effort:** 1-2 weeks

## Summary

Replace `'unsafe-inline'` in Content Security Policy with nonce-based script execution to harden against XSS attacks while maintaining functionality.

## Motivation

**Current CSP:**
```
script-src 'self' 'unsafe-inline' https://...
```

**Issue:** `'unsafe-inline'` allows any inline script, reducing XSS protection.

## Design

**Generate Nonce per Request:**
```typescript
// middleware.ts
export function middleware(request: NextRequest) {
  const nonce = crypto.randomBytes(16).toString("base64");
  const response = NextResponse.next();
  
  response.headers.set(
    "Content-Security-Policy",
    `script-src 'self' 'nonce-${nonce}' https://...`
  );
  
  response.headers.set("x-nonce", nonce);
  return response;
}
```

**Use Nonce in Components:**
```typescript
import { headers } from "next/headers";

export default function Page() {
  const nonce = headers().get("x-nonce");
  
  return (
    <>
      <script nonce={nonce}>
        console.log("This script is allowed");
      </script>
    </>
  );
}
```

**Estimated Impact:** Medium - Improved XSS protection
