# RFC-0008: Automated PII Detection and Handling

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Medium (Quick Win)  
**Effort:** 1-2 weeks

## Summary

Implement automated detection and optional masking/encryption of Personally Identifiable Information (PII) in survey responses to improve compliance with GDPR, CCPA, and other privacy regulations.

## Motivation

**Current State:**
- Survey responses stored as-is
- No automatic PII detection
- Manual review required for compliance
- Risk of accidentally collecting sensitive data

**Compliance Requirements:**
- GDPR: Right to deletion, data minimization
- CCPA: Consumer data rights
- HIPAA: Protected health information
- SOC 2: Data protection controls

## Detailed Design

### PII Detection Patterns

```typescript
// lib/pii-detection/patterns.ts
export const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?1[-.]?)?\(?([0-9]{3})\)?[-.]?([0-9]{3})[-.]?([0-9]{4})\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
  ipAddress: /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g,
  
  // Custom patterns
  postalCode: /\b\d{5}(?:-\d{4})?\b/g,
  dob: /\b(?:0[1-9]|1[0-2])\/(?:0[1-9]|[12][0-9]|3[01])\/(?:19|20)\d{2}\b/g,
};

export function detectPII(text: string): PIIDetectionResult[] {
  const results: PIIDetectionResult[] = [];
  
  for (const [type, pattern] of Object.entries(PII_PATTERNS)) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      results.push({
        type: type as PIIType,
        value: match[0],
        index: match.index!,
        confidence: calculateConfidence(type, match[0]),
      });
    }
  }
  
  return results;
}
```

### Handling Strategies

**1. Alert Only:**
```typescript
// Notify admins of PII in responses
export async function scanResponseForPII(response: TResponse) {
  const piiFound: PIIDetectionResult[] = [];
  
  for (const [questionId, answer] of Object.entries(response.data)) {
    if (typeof answer === "string") {
      const detected = detectPII(answer);
      piiFound.push(...detected);
    }
  }
  
  if (piiFound.length > 0) {
    await sendPIIAlert({
      responseId: response.id,
      surveyId: response.surveyId,
      piiTypes: [...new Set(piiFound.map(p => p.type))],
      count: piiFound.length,
    });
  }
}
```

**2. Automatic Masking:**
```typescript
export function maskPII(text: string, options: MaskOptions): string {
  let masked = text;
  
  const detected = detectPII(text);
  
  // Sort by index (descending) to avoid index shifting
  detected.sort((a, b) => b.index - a.index);
  
  for (const pii of detected) {
    if (options.types.includes(pii.type)) {
      const replacement = options.strategy === "redact" 
        ? "[REDACTED]"
        : pii.value.slice(0, 2) + "***" + pii.value.slice(-2);
      
      masked = masked.substring(0, pii.index) + 
               replacement + 
               masked.substring(pii.index + pii.value.length);
    }
  }
  
  return masked;
}
```

**3. Encryption:**
```typescript
// Encrypt PII separately, store reference
export async function encryptPII(response: TResponse): Promise<TResponse> {
  const encryptedData = { ...response.data };
  const piiReferences: PIIReference[] = [];
  
  for (const [questionId, answer] of Object.entries(response.data)) {
    if (typeof answer === "string") {
      const detected = detectPII(answer);
      
      if (detected.length > 0) {
        // Encrypt original answer
        const encrypted = await encryptionService.encrypt(answer);
        
        // Store encrypted reference
        const ref = await prisma.pIIReference.create({
          data: {
            responseId: response.id,
            questionId,
            encryptedValue: encrypted.ciphertext,
            keyId: encrypted.keyId,
            piiTypes: detected.map(d => d.type),
          },
        });
        
        // Replace with masked version
        encryptedData[questionId] = maskPII(answer, {
          types: detected.map(d => d.type),
          strategy: "partial",
        });
        
        piiReferences.push(ref);
      }
    }
  }
  
  return { ...response, data: encryptedData, piiReferences };
}
```

### Configuration

```typescript
// Organization PII policy
model OrganizationPIIPolicy {
  id                String   @id
  organizationId    String   @unique
  
  enabled           Boolean  @default(false)
  strategy          PIIStrategy  // alert, mask, encrypt
  
  detectEmail       Boolean  @default(true)
  detectPhone       Boolean  @default(true)
  detectSSN         Boolean  @default(true)
  detectCreditCard  Boolean  @default(true)
  
  customPatterns    Json?    // Custom regex patterns
  
  autoDelete        Boolean  @default(false)
  retentionDays     Int?     // Auto-delete after N days
}
```

## Implementation Plan

**Week 1:**
- [ ] Implement PII detection patterns
- [ ] Add masking/encryption functions
- [ ] Database schema for PII policies

**Week 2:**
- [ ] UI for PII policy configuration
- [ ] Integration with response pipeline
- [ ] Reporting dashboard
- [ ] Documentation

## Success Criteria

- [ ] Detects common PII types (email, phone, SSN, credit card)
- [ ] <1% false positives
- [ ] >95% true positive rate
- [ ] Configurable per organization
- [ ] GDPR compliance improved

**Estimated Impact:** Medium - Improves compliance, reduces manual review
