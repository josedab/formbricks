# RFC-0009: Configurable Password Policies

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Low (Long-term)  
**Effort:** 2 weeks

## Summary

Implement configurable password policies (complexity, length, expiration, history) to meet enterprise compliance requirements (SOC 2, ISO 27001, NIST guidelines).

## Motivation

**Current State:**
- No password complexity requirements
- No password expiration
- No password history (can reuse immediately)
- Maximum length: 128 characters (DoS prevention only)

**Compliance Gaps:**
- SOC 2 requires password policies
- NIST 800-63B recommendations
- Many enterprises require configurable policies

## Design

```typescript
model PasswordPolicy {
  id                    String   @id
  organizationId        String   @unique
  
  minLength             Int      @default(8)
  requireUppercase      Boolean  @default(false)
  requireLowercase      Boolean  @default(false)
  requireNumbers        Boolean  @default(false)
  requireSpecialChars   Boolean  @default(false)
  
  expirationDays        Int?     // null = no expiration
  historyCount          Int      @default(0)  // 0 = no history
  
  preventCommonPasswords Boolean @default(false)
}
```

**Implementation:** Validate on signup/password change, warn before expiration, store hashed history.

**Estimated Impact:** Low - Enterprise compliance
