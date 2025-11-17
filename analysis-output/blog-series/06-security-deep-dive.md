# Security Deep Dive

**Part 6 of 7 - Formbricks Technical Deep Dive**
**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## Security Scorecard: 4.5/5

### Strengths ✅

**Authentication:**
- Multi-factor authentication (TOTP + backup codes)
- bcrypt password hashing (cost factor 12)
- Timing attack prevention
- Session management (NextAuth.js)

**Encryption:**
- AES-256-GCM for sensitive data
- Proper IV generation (16 bytes)
- Authentication tags for integrity

**API Security:**
- Rate limiting (IP-based, Redis-backed)
- CORS configuration
- API key authentication (SHA-256 + bcrypt hybrid)

**Security Headers:**
- CSP, HSTS, X-Frame-Options
- X-Content-Type-Options
- Referrer-Policy

**Input Validation:**
- Zod schemas throughout
- File upload validation
- XSS prevention (React + DOMPurify)

### Critical Improvements Needed 🚨

**1. SSRF Protection (RFC-0003)**
- **Risk:** Webhooks can target internal networks
- **Fix:** Validate URLs, block private IPs
- **Effort:** 2 hours

**2. Encryption Key Rotation (RFC-0001)**
- **Risk:** Single key for all encrypted data
- **Fix:** Implement key versioning
- **Effort:** 2-3 weeks

**3. Webhook Signatures (RFC-0004)**
- **Risk:** No payload verification
- **Fix:** HMAC-SHA256 signatures
- **Effort:** 1 week

## Authentication Flows

**Password Authentication:**
```typescript
// Timing attack prevention
export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  // Always verify against something (prevents timing attacks)
  const hash = hashedPassword || CONTROL_HASH;
  
  const isValid = await bcrypt.compare(password, hash);
  
  // If user doesn't exist, still return false (constant time)
  return hashedPassword ? isValid : false;
}
```

**2FA Flow:**
```typescript
// 1. Generate secret
const secret = authenticator.generateSecret();

// 2. User scans QR code
const qrCode = await QRCode.toDataURL(
  authenticator.keyuri(email, "Formbricks", secret)
);

// 3. Verify token
const isValid = authenticator.verify({
  token: userToken,
  secret: encryptedSecret
});

// 4. Generate backup codes
const backupCodes = Array.from({ length: 10 }, () =>
  crypto.randomBytes(4).toString("hex")
);
```

## Data Protection

**Encryption:**
```typescript
export function symmetricEncryptGCM(text: string, key: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}
```

**PII Handling (RFC-0008):**
- Automated detection patterns
- Optional masking/encryption
- GDPR compliance helpers

## Authorization Model

**Three Levels:**

1. **Organization Roles:** owner, manager, member
2. **Project Teams:** read, readWrite, manage
3. **Teams (EE):** contributor, admin

**Flexible Authorization:**
```typescript
await checkAuthorizationUpdated({
  userId: ctx.user.id,
  organizationId,
  access: [
    { type: "organization", roles: ["owner", "manager"] },
    { type: "projectTeam", minPermission: "readWrite", projectId }
  ]
});
// Requires EITHER org owner/manager OR project readWrite permission
```

## Key Takeaways

1. **Strong foundation** - Authentication, encryption, rate limiting
2. **Critical gaps** - SSRF, key rotation, webhook signatures
3. **Compliance-ready** - GDPR helpers, audit logging (EE)
4. **Proactive patching** - Security overrides documented
5. **Testing** - Security test suite validates protections

**Immediate Actions:**
1. Fix SSRF vulnerability (RFC-0003)
2. Implement webhook signatures (RFC-0004)
3. Plan key rotation (RFC-0001)

Next: **Part 7 - Deployment and Operations**
