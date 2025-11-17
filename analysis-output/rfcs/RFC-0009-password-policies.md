# RFC-0009: Configurable Password Policies

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-16
**Updated:** 2025-11-17
**Priority:** Low (Long-term)
**Effort:** 2 weeks
**Impact:** Medium (Enterprise compliance)

## Executive Summary

Implement organization-level configurable password policies to meet enterprise security and compliance requirements (SOC 2, ISO 27001, HIPAA, NIST 800-63B). This RFC proposes a flexible policy engine that allows organizations to enforce password complexity, expiration, history, and common password prevention while maintaining usability.

## Table of Contents

1. [Motivation](#motivation)
2. [Current State Analysis](#current-state-analysis)
3. [Detailed Design](#detailed-design)
4. [Implementation Plan](#implementation-plan)
5. [Security Considerations](#security-considerations)
6. [User Experience](#user-experience)
7. [Testing Strategy](#testing-strategy)
8. [Migration Strategy](#migration-strategy)
9. [Alternatives Considered](#alternatives-considered)
10. [Success Metrics](#success-metrics)

## Motivation

### Business Drivers

**Compliance Requirements:**
- SOC 2 Type II requires documented password policies
- ISO 27001 (A.9.4.3) mandates password management systems
- HIPAA requires password complexity for healthcare customers
- NIST 800-63B provides password security guidelines
- Many enterprise customers require configurable policies for procurement

**Current Limitations:**
```typescript
// apps/web/lib/auth/password.ts (current implementation)
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128; // DoS prevention only

export function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, error: "Password must be at least 8 characters" };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, error: "Password too long" };
  }
  return { valid: true };
}
```

**Problems:**
- ❌ No complexity requirements (uppercase, lowercase, numbers, special characters)
- ❌ No password expiration
- ❌ No password history (users can immediately reuse old passwords)
- ❌ No prevention of common/weak passwords
- ❌ Not configurable per organization

### Competitive Analysis

| Feature | Formbricks (Current) | Qualtrics | SurveyMonkey | Typeform |
|---------|---------------------|-----------|--------------|----------|
| Min Length | ✅ (8 chars) | ✅ (Configurable) | ✅ (12 chars) | ✅ (10 chars) |
| Complexity | ❌ | ✅ | ✅ | ✅ |
| Expiration | ❌ | ✅ (90 days default) | ✅ (Optional) | ❌ |
| History | ❌ | ✅ (24 passwords) | ✅ (5 passwords) | ❌ |
| Common Password Check | ❌ | ✅ | ✅ | ❌ |
| Per-Org Config | ❌ | ✅ | ✅ (Enterprise) | ❌ |

## Current State Analysis

### Existing Password Flow

**Signup Flow:**
```typescript
// apps/web/app/api/auth/signup/route.ts
export async function POST(request: Request) {
  const { name, email, password } = await request.json();

  // Validation
  const validation = validatePassword(password);
  if (!validation.valid) {
    return Response.json({ error: validation.error }, { status: 400 });
  }

  // Hash with bcrypt
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  await prisma.user.create({
    data: { name, email, password: hashedPassword }
  });
}
```

**Password Change Flow:**
```typescript
// apps/web/app/(app)/environments/[environmentId]/settings/profile/actions.ts
export async function updatePassword(
  currentPassword: string,
  newPassword: string
) {
  // Verify current password
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) throw new Error("Invalid current password");

  // Validate new password
  const validation = validatePassword(newPassword);
  if (!validation.valid) throw new Error(validation.error);

  // Hash and update
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashedPassword }
  });
}
```

**Database Schema (Current):**
```prisma
model User {
  id              String   @id @default(cuid())
  email           String   @unique
  password        String
  // No password-related fields (lastPasswordChange, passwordHistory, etc.)
}
```

## Detailed Design

### Database Schema Changes

```prisma
// packages/database/schema.prisma

/// Organization-level password policy configuration
model PasswordPolicy {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  // Complexity Requirements
  minLength              Int      @default(8)
  maxLength              Int      @default(128)
  requireUppercase       Boolean  @default(false)
  requireLowercase       Boolean  @default(false)
  requireNumbers         Boolean  @default(false)
  requireSpecialChars    Boolean  @default(false)
  specialCharsSet        String   @default("!@#$%^&*()_+-=[]{}|;:,.<>?")

  // Expiration Settings
  expirationDays         Int?     // null = no expiration
  expirationWarningDays  Int      @default(7)  // Warn N days before expiration

  // History Settings
  preventReuseCount      Int      @default(0)  // 0 = no history check

  // Common Password Prevention
  preventCommonPasswords Boolean  @default(false)
  customBlockedWords     String[] @default([])  // Block org-specific words (e.g., company name)

  // Grace Period (for newly enforced policies)
  gracePeriodDays        Int      @default(30)
  enforcedAt             DateTime @default(now())

  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@index([organizationId])
}

/// Track password history for reuse prevention
model PasswordHistory {
  id             String   @id @default(cuid())
  userId         String
  user           User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  passwordHash   String   // bcrypt hash
  createdAt      DateTime @default(now())

  @@index([userId, createdAt])
}

/// Extend User model
model User {
  // ... existing fields ...

  lastPasswordChange  DateTime?      @default(now())
  passwordHistory     PasswordHistory[]
  passwordExpiredAt   DateTime?      // Set when password expires

  // When password policy is enforced, give users grace period
  passwordPolicyAcknowledgedAt DateTime?
}
```

### Core Validation Logic

```typescript
// apps/web/lib/auth/password-policy.ts

import { PasswordPolicy } from "@prisma/client";

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  warnings?: string[];
}

export interface PasswordStrengthResult {
  score: number; // 0-4 (zxcvbn style)
  feedback: string[];
}

/**
 * Validate password against organization policy
 */
export async function validatePasswordPolicy(
  password: string,
  organizationId: string
): Promise<PasswordValidationResult> {
  const errors: string[] = [];

  // Get organization policy (or use defaults)
  const policy = await getPasswordPolicy(organizationId);

  // Length validation
  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters`);
  }

  // Complexity validation
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }
  if (policy.requireNumbers && !/\d/.test(password)) {
    errors.push("Password must contain at least one number");
  }
  if (policy.requireSpecialChars) {
    const specialCharsRegex = new RegExp(`[${escapeRegex(policy.specialCharsSet)}]`);
    if (!specialCharsRegex.test(password)) {
      errors.push(
        `Password must contain at least one special character (${policy.specialCharsSet})`
      );
    }
  }

  // Common password check
  if (policy.preventCommonPasswords) {
    const isCommon = await checkCommonPassword(password);
    if (isCommon) {
      errors.push("This password is too common. Please choose a more unique password.");
    }
  }

  // Custom blocked words (organization name, product name, etc.)
  if (policy.customBlockedWords.length > 0) {
    const lowerPassword = password.toLowerCase();
    for (const word of policy.customBlockedWords) {
      if (lowerPassword.includes(word.toLowerCase())) {
        errors.push(`Password cannot contain the word "${word}"`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if password has been used recently
 */
export async function checkPasswordHistory(
  userId: string,
  newPassword: string,
  organizationId: string
): Promise<{ reused: boolean; error?: string }> {
  const policy = await getPasswordPolicy(organizationId);

  if (policy.preventReuseCount === 0) {
    return { reused: false };
  }

  // Get recent password hashes
  const history = await prisma.passwordHistory.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: policy.preventReuseCount,
  });

  // Check if new password matches any recent password
  for (const entry of history) {
    const matches = await bcrypt.compare(newPassword, entry.passwordHash);
    if (matches) {
      return {
        reused: true,
        error: `You cannot reuse any of your last ${policy.preventReuseCount} passwords`,
      };
    }
  }

  return { reused: false };
}

/**
 * Check against common password list (top 100k)
 */
async function checkCommonPassword(password: string): Promise<boolean> {
  // Implementation options:
  // 1. In-memory set (fast, ~2MB RAM for 100k passwords)
  // 2. Redis set (distributed, shared across instances)
  // 3. File-based lookup with binary search

  const lowerPassword = password.toLowerCase();

  // Load from embedded list or cache
  const commonPasswords = await getCommonPasswordList();
  return commonPasswords.has(lowerPassword);
}

/**
 * Calculate password expiration
 */
export function calculatePasswordExpiration(
  lastPasswordChange: Date,
  expirationDays: number | null
): { expired: boolean; expiresAt: Date | null; daysRemaining: number | null } {
  if (!expirationDays) {
    return { expired: false, expiresAt: null, daysRemaining: null };
  }

  const expiresAt = new Date(lastPasswordChange);
  expiresAt.setDate(expiresAt.getDate() + expirationDays);

  const now = new Date();
  const expired = now > expiresAt;
  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return { expired, expiresAt, daysRemaining };
}

/**
 * Password strength estimation (zxcvbn-style)
 */
export function estimatePasswordStrength(password: string): PasswordStrengthResult {
  let score = 0;
  const feedback: string[] = [];

  // Length scoring
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;

  // Complexity scoring
  let complexityScore = 0;
  if (/[a-z]/.test(password)) complexityScore++;
  if (/[A-Z]/.test(password)) complexityScore++;
  if (/\d/.test(password)) complexityScore++;
  if (/[^a-zA-Z0-9]/.test(password)) complexityScore++;

  if (complexityScore >= 3) score++;

  // Entropy/unpredictability (simplified)
  const uniqueChars = new Set(password).size;
  if (uniqueChars / password.length > 0.5) score++;

  // Cap at 4
  score = Math.min(score, 4);

  // Generate feedback
  if (score < 2) {
    feedback.push("Add more characters to make your password stronger");
  }
  if (complexityScore < 3) {
    feedback.push("Mix uppercase, lowercase, numbers, and symbols");
  }
  if (/(.)\1{2,}/.test(password)) {
    feedback.push("Avoid repeating characters");
  }

  return { score, feedback };
}
```

### Password Change Flow with Policy

```typescript
// apps/web/app/(app)/environments/[environmentId]/settings/profile/actions.ts

export async function updatePassword(
  currentPassword: string,
  newPassword: string
) {
  const user = await getUser();
  const organizationId = await getUserOrganizationId(user.id);

  // 1. Verify current password
  const valid = await verifyPassword(currentPassword, user.password);
  if (!valid) {
    throw new Error("Current password is incorrect");
  }

  // 2. Validate against policy
  const policyValidation = await validatePasswordPolicy(newPassword, organizationId);
  if (!policyValidation.valid) {
    throw new Error(policyValidation.errors.join(". "));
  }

  // 3. Check password history
  const historyCheck = await checkPasswordHistory(user.id, newPassword, organizationId);
  if (historyCheck.reused) {
    throw new Error(historyCheck.error);
  }

  // 4. Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 12);

  // 5. Update user and add to history
  await prisma.$transaction([
    // Update user
    prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        lastPasswordChange: new Date(),
        passwordExpiredAt: null, // Reset expiration
      },
    }),

    // Add to history
    prisma.passwordHistory.create({
      data: {
        userId: user.id,
        passwordHash: hashedPassword,
      },
    }),
  ]);

  // 6. Clean up old history beyond retention count
  const policy = await getPasswordPolicy(organizationId);
  if (policy.preventReuseCount > 0) {
    const oldHistory = await prisma.passwordHistory.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      skip: policy.preventReuseCount,
    });

    if (oldHistory.length > 0) {
      await prisma.passwordHistory.deleteMany({
        where: { id: { in: oldHistory.map((h) => h.id) } },
      });
    }
  }
}
```

### Expiration Enforcement

```typescript
// middleware.ts or auth callback

export async function checkPasswordExpiration(userId: string): Promise<{
  expired: boolean;
  warning: boolean;
  daysRemaining: number | null;
}> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      lastPasswordChange: true,
      memberships: {
        select: {
          organization: {
            select: {
              passwordPolicy: true,
            },
          },
        },
      },
    },
  });

  if (!user || !user.lastPasswordChange) {
    return { expired: false, warning: false, daysRemaining: null };
  }

  // Get policy from user's primary organization
  const policy = user.memberships[0]?.organization.passwordPolicy;
  if (!policy || !policy.expirationDays) {
    return { expired: false, warning: false, daysRemaining: null };
  }

  const { expired, daysRemaining } = calculatePasswordExpiration(
    user.lastPasswordChange,
    policy.expirationDays
  );

  const warning = daysRemaining !== null && daysRemaining <= policy.expirationWarningDays;

  return { expired, warning, daysRemaining };
}

// NextAuth callback
async function session({ session, token }) {
  if (token.sub) {
    const expiration = await checkPasswordExpiration(token.sub);

    if (expiration.expired) {
      // Force password change
      return {
        ...session,
        passwordExpired: true,
        error: "PasswordExpired",
      };
    }

    if (expiration.warning) {
      // Show warning banner
      session.passwordExpiresIn = expiration.daysRemaining;
    }
  }

  return session;
}
```

## Implementation Plan

### Phase 1: Database & Core Logic (Week 1, Days 1-3)

**Tasks:**
1. Create Prisma migration for PasswordPolicy and PasswordHistory models
2. Implement `validatePasswordPolicy()` function
3. Implement `checkPasswordHistory()` function
4. Add common password list (top 10k most common passwords)
5. Write unit tests for validation logic

**Deliverables:**
- Migration: `20251117_add_password_policies.sql`
- File: `apps/web/lib/auth/password-policy.ts`
- Test: `apps/web/lib/auth/password-policy.test.ts`

### Phase 2: Password Change Flow (Week 1, Days 4-5)

**Tasks:**
1. Update password change action to use policy validation
2. Update signup flow to use policy validation
3. Add password history tracking
4. Implement password expiration calculation

**Deliverables:**
- Updated: `apps/web/app/(app)/environments/[environmentId]/settings/profile/actions.ts`
- Updated: `apps/web/app/api/auth/signup/route.ts`

### Phase 3: UI Components (Week 2, Days 1-3)

**Tasks:**
1. Create password policy configuration page (org settings)
2. Add real-time password strength indicator (signup/change password forms)
3. Add password expiration warning banner
4. Create force password change page (for expired passwords)

**Deliverables:**
- New page: `apps/web/app/(app)/environments/[environmentId]/settings/security/password-policy/page.tsx`
- Component: `apps/web/modules/auth/components/password-strength-meter.tsx`
- Component: `apps/web/modules/auth/components/password-expiration-banner.tsx`
- Page: `apps/web/app/auth/change-password/page.tsx`

### Phase 4: Background Jobs & Notifications (Week 2, Days 4-5)

**Tasks:**
1. Create cron job to check for expiring passwords
2. Send email notifications (7 days, 3 days, 1 day before expiration)
3. Implement grace period enforcement
4. Add audit logging for policy changes

**Deliverables:**
- Cron: `apps/web/app/api/cron/check-password-expiration/route.ts`
- Email template: `packages/email/templates/password-expiring.tsx`

## Security Considerations

### Password Hashing

**Continue using bcrypt:**
- Cost factor: 12 (current)
- Upgrade to Argon2id in future (better resistance to GPU attacks)

### Password History Storage

**Security:**
- Store full bcrypt hashes (not plaintext or reversible)
- Use same hashing as current passwords
- Limit history to reasonable size (24 passwords max)

### Timing Attacks

**Prevention:**
```typescript
// Constant-time comparison for history check
async function checkPasswordHistory(userId, newPassword, policy) {
  const history = await getHistory(userId, policy.preventReuseCount);

  let matches = false;

  // Check ALL hashes to prevent timing attacks
  for (const entry of history) {
    const result = await bcrypt.compare(newPassword, entry.passwordHash);
    matches = matches || result;
  }

  return matches;
}
```

### Common Password List

**Implementation:**
- Use HIBP (Have I Been Pwned) top 100k passwords
- Hash passwords before comparison (k-anonymity for API)
- Fallback to local list if API unavailable

### Grace Period Enforcement

**Logic:**
```typescript
function shouldEnforcePolicy(user, policy) {
  const gracePeriodEnd = new Date(policy.enforcedAt);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + policy.gracePeriodDays);

  // If user joined before enforcement and within grace period
  if (user.createdAt < policy.enforcedAt && new Date() < gracePeriodEnd) {
    return false; // Don't enforce yet
  }

  return true; // Enforce policy
}
```

## User Experience

### Password Strength Indicator

```typescript
// Visual feedback during password entry
<PasswordStrengthMeter password={password} policy={policy} />
```

**Display:**
- Progress bar (0-100%)
- Color: Red → Yellow → Green
- Text: "Weak" → "Fair" → "Good" → "Strong" → "Very Strong"
- Real-time feedback as user types

### Expiration Warnings

**Email Schedule:**
- 30 days before expiration (if configured)
- 7 days before expiration
- 3 days before expiration
- 1 day before expiration
- On expiration day

**In-app Banner:**
```typescript
{passwordExpiresIn && (
  <Alert variant="warning">
    Your password will expire in {passwordExpiresIn} days.
    <Link href="/settings/profile">Change Password</Link>
  </Alert>
)}
```

### Force Password Change

**Flow:**
1. User logs in with expired password
2. Redirect to `/auth/change-password` (cannot access app)
3. Must change password to continue
4. Redirect to original destination after change

## Testing Strategy

### Unit Tests

```typescript
describe("validatePasswordPolicy", () => {
  it("should enforce minimum length", async () => {
    const result = await validatePasswordPolicy("short", orgId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("at least 8 characters");
  });

  it("should enforce complexity requirements", async () => {
    const policy = {
      requireUppercase: true,
      requireNumbers: true,
    };

    const result = await validatePasswordPolicy("lowercase", orgId);
    expect(result.errors).toContain("uppercase letter");
    expect(result.errors).toContain("number");
  });

  it("should reject common passwords", async () => {
    const result = await validatePasswordPolicy("password123", orgId);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("too common");
  });
});

describe("checkPasswordHistory", () => {
  it("should prevent password reuse", async () => {
    // Setup: User has used "OldPassword1!" before
    await setupPasswordHistory(userId, ["OldPassword1!"]);

    const result = await checkPasswordHistory(userId, "OldPassword1!", orgId);
    expect(result.reused).toBe(true);
  });
});
```

### Integration Tests

```typescript
describe("Password Change Flow", () => {
  it("should enforce policy on password change", async () => {
    await expect(
      updatePassword("current123", "weak")
    ).rejects.toThrow("at least 8 characters");
  });

  it("should add password to history", async () => {
    await updatePassword("current123", "NewStrong1!");

    const history = await prisma.passwordHistory.findMany({
      where: { userId },
    });

    expect(history).toHaveLength(1);
  });
});
```

### E2E Tests

```typescript
test("should show password strength indicator", async ({ page }) => {
  await page.goto("/auth/signup");

  await page.fill('[name="password"]', "weak");
  await expect(page.locator(".password-strength")).toHaveText("Weak");

  await page.fill('[name="password"]', "StrongPassword1!");
  await expect(page.locator(".password-strength")).toHaveText("Strong");
});

test("should prevent expired password login", async ({ page }) => {
  // Setup: User with expired password
  await setupExpiredPassword(user);

  await page.goto("/auth/login");
  await page.fill('[name="email"]', user.email);
  await page.fill('[name="password"]', "password");
  await page.click('[type="submit"]');

  // Should redirect to password change page
  await expect(page).toHaveURL("/auth/change-password");
});
```

## Migration Strategy

### Existing Users

**Scenario 1: Organization enables policy for first time**
- Grace period: 30 days (default)
- Send email notification about new requirements
- Show banner: "New password requirements will be enforced in X days"
- After grace period: Force password change on next login

**Scenario 2: Organization strengthens existing policy**
- Same grace period approach
- Users with compliant passwords: No action needed
- Users with non-compliant passwords: Must change after grace period

### Data Migration

```typescript
// Migration script
async function migrateExistingPasswords() {
  const users = await prisma.user.findMany({
    where: { password: { not: null } },
  });

  for (const user of users) {
    // Set lastPasswordChange to account creation date if not set
    if (!user.lastPasswordChange) {
      await prisma.user.update({
        where: { id: user.id },
        data: { lastPasswordChange: user.createdAt },
      });
    }

    // Create initial password history entry
    await prisma.passwordHistory.create({
      data: {
        userId: user.id,
        passwordHash: user.password,
        createdAt: user.lastPasswordChange || user.createdAt,
      },
    });
  }
}
```

## Alternatives Considered

### Alternative 1: Global Policy (Not Per-Organization)

**Pros:**
- Simpler implementation
- Consistent security baseline

**Cons:**
- ❌ Not flexible for enterprise customers
- ❌ Cannot meet diverse compliance needs
- ❌ Forces same policy on all organizations

**Decision:** Rejected. Enterprise customers require customization.

### Alternative 2: Use External Password Manager Integration

**Pros:**
- Delegate password policy to password managers (1Password, LastPass, etc.)
- Users get better password generation tools

**Cons:**
- ❌ Still need basic password policy for non-manager users
- ❌ Cannot enforce expiration through external tools
- ❌ Compliance requires documented policies

**Decision:** Complementary, not alternative. Support both.

### Alternative 3: Passkeys Only (No Passwords)

**Pros:**
- More secure (phishing-resistant)
- Better UX (biometric auth)
- No password policies needed

**Cons:**
- ❌ Not all users have compatible devices
- ❌ Enterprise customers still require passwords
- ❌ Backup authentication still needed

**Decision:** Future enhancement. Keep passwords with policies for now.

## Success Metrics

### Adoption Metrics

- **Target:** 30% of organizations enable custom policies within 6 months
- **Measure:** Count of PasswordPolicy records with non-default values

### Security Metrics

- **Password Strength:** Average password strength score increases from 2.1 to 3.5+
- **Common Passwords:** <1% of users using top 10k common passwords (down from ~8%)
- **Password Age:** Average password age decreases from 365+ days to <90 days

### Compliance Metrics

- **SOC 2 Audit:** Password policy requirement satisfied
- **Enterprise Sales:** Reduction in "password policy" as deal blocker

### User Experience Metrics

- **Lockouts:** <2% of users locked out due to expired passwords (with proper warnings)
- **Support Tickets:** <5% increase in password-related support requests

## References

- [NIST 800-63B Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Have I Been Pwned Password API](https://haveibeenpwned.com/API/v3#PwnedPasswords)
- [zxcvbn Password Strength Estimation](https://github.com/dropbox/zxcvbn)

## Appendices

### Appendix A: Common Password List

Top 20 most common passwords (for reference):
1. 123456
2. password
3. 123456789
4. 12345678
5. 12345
6. qwerty
7. 123123
8. password123
9. 1234567890
10. 1234567
11. abc123
12. 111111
13. password1
14. 123321
15. 1234
16. 12345678910
17. 000000
18. Aa123456
19. 1234567891
20. 123456a

*Full list of 100k will be embedded in implementation*

### Appendix B: Default Policy

```typescript
export const DEFAULT_PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: false,
  requireLowercase: false,
  requireNumbers: false,
  requireSpecialChars: false,
  specialCharsSet: "!@#$%^&*()_+-=[]{}|;:,.<>?",
  expirationDays: null,
  expirationWarningDays: 7,
  preventReuseCount: 0,
  preventCommonPasswords: false,
  customBlockedWords: [],
  gracePeriodDays: 30,
};
```

### Appendix C: Recommended Policies by Compliance Standard

**SOC 2 Type II:**
```typescript
{
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  expirationDays: 90,
  preventReuseCount: 24,
  preventCommonPasswords: true,
}
```

**HIPAA:**
```typescript
{
  minLength: 8,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  expirationDays: 90,
  preventReuseCount: 10,
  preventCommonPasswords: true,
}
```

**ISO 27001:**
```typescript
{
  minLength: 10,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  expirationDays: 90,
  preventReuseCount: 12,
  preventCommonPasswords: true,
}
```
