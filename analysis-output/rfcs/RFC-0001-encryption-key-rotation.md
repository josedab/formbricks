# RFC-0001: Encryption Key Rotation Mechanism

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-16
**Priority:** High (Strategic)
**Effort:** 2-3 weeks

## Summary

Implement a key versioning and rotation system for the encryption key (`ENCRYPTION_KEY`) to improve security posture and enable compliance with security policies requiring regular key rotation.

## Motivation

**Current State:**
- Single `ENCRYPTION_KEY` encrypts all sensitive data (2FA secrets, backup codes, email tokens)
- No key rotation mechanism
- If key is compromised, all data is at risk
- No audit trail of which key encrypted which data

**Problems:**
1. **Security Risk:** Single point of failure
2. **Compliance:** Many security standards require regular key rotation
3. **Incident Response:** No way to rotate keys after suspected compromise without manual re-encryption
4. **Key Management:** No versioning or lifecycle management

## Detailed Design

### Key Versioning Schema

```typescript
interface EncryptionKey {
  id: string;           // e.g., "key_v1", "key_v2"
  value: string;        // 32-byte hex key
  createdAt: Date;
  retiredAt: Date | null;
  status: "active" | "deprecated" | "retired";
}
```

### Database Changes

```prisma
model EncryptionKey {
  id         String   @id
  value      String   // Encrypted with master key
  createdAt  DateTime @default(now())
  retiredAt  DateTime?
  status     String   @default("active")
}

// Add keyId to encrypted fields
model User {
  twoFactorSecret    String?
  twoFactorKeyId     String? // References EncryptionKey
  backupCodes        String?
  backupCodesKeyId   String?
}
```

### Encryption Service Update

```typescript
// lib/crypto.ts
interface EncryptionService {
  encrypt(plaintext: string): Promise<{ 
    ciphertext: string; 
    keyId: string;
  }>;
  
  decrypt(ciphertext: string, keyId: string): Promise<string>;
  
  rotateKey(oldKeyId: string, newKeyId: string): Promise<void>;
}

// Example usage
const encrypted = await encryptionService.encrypt("secret");
// Returns: { ciphertext: "...", keyId: "key_v2" }

// Store both ciphertext and keyId
await prisma.user.update({
  where: { id: userId },
  data: {
    twoFactorSecret: encrypted.ciphertext,
    twoFactorKeyId: encrypted.keyId
  }
});
```

### Key Rotation Process

**Manual Rotation (Admin Command):**
```bash
# Generate new key
pnpm --filter @formbricks/web generate-encryption-key

# Rotate all encrypted data
pnpm --filter @formbricks/web rotate-encryption-key \
  --old-key-id=key_v1 \
  --new-key-id=key_v2 \
  --batch-size=1000
```

**Automatic Rotation (Scheduled):**
```typescript
// apps/web/app/api/cron/rotate-encryption-key/route.ts
export async function POST(req: Request) {
  // Verify cron secret
  if (req.headers.get("authorization") !== `Bearer ${CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  
  // Check if rotation needed (e.g., key older than 90 days)
  const activeKey = await getActiveKey();
  if (isOlderThan(activeKey.createdAt, 90, "days")) {
    await rotateEncryptionKey();
  }
  
  return Response.json({ success: true });
}
```

### Migration Strategy

**Phase 1: Add Key Versioning**
1. Add `EncryptionKey` model
2. Create initial key record with current `ENCRYPTION_KEY`
3. Add `*KeyId` fields to all encrypted columns
4. Backfill `keyId` for existing data

**Phase 2: Update Encryption Service**
1. Modify `symmetricEncrypt()` to return keyId
2. Update all encryption call sites to store keyId
3. Add backward compatibility for old data (null keyId = use default key)

**Phase 3: Enable Rotation**
1. Implement rotation command
2. Add monitoring for key age
3. Document rotation procedure

**Phase 4: Enforce Key Lifecycle**
1. Retire keys older than policy (e.g., 1 year)
2. Alert when keys near expiration
3. Prevent decryption with retired keys (except for migration)

## Example Usage

**Before:**
```typescript
const encrypted = symmetricEncrypt("secret", ENCRYPTION_KEY);
await prisma.user.update({ data: { twoFactorSecret: encrypted } });

// Decrypt
const decrypted = symmetricDecrypt(user.twoFactorSecret, ENCRYPTION_KEY);
```

**After:**
```typescript
const { ciphertext, keyId } = await encryptionService.encrypt("secret");
await prisma.user.update({ 
  data: { 
    twoFactorSecret: ciphertext,
    twoFactorKeyId: keyId
  } 
});

// Decrypt
const decrypted = await encryptionService.decrypt(
  user.twoFactorSecret,
  user.twoFactorKeyId
);
```

## Implementation Plan

**Week 1:**
- [ ] Design and review encryption service interface
- [ ] Create database migration for `EncryptionKey` model
- [ ] Implement key storage (encrypted with master key)

**Week 2:**
- [ ] Update encryption functions to support versioning
- [ ] Add backward compatibility layer
- [ ] Write unit tests for encryption service

**Week 3:**
- [ ] Implement rotation command
- [ ] Create monitoring dashboard for key lifecycle
- [ ] Document rotation procedures

**Week 4:**
- [ ] Test rotation in staging environment
- [ ] Perform security review
- [ ] Deploy to production

**Week 5:**
- [ ] Execute first key rotation in production
- [ ] Monitor for issues
- [ ] Update documentation

## Backwards Compatibility

**Existing Encrypted Data:**
- Data without `keyId` → use default key (current `ENCRYPTION_KEY`)
- Gradual migration: re-encrypt on next update
- Forced migration: scheduled job to re-encrypt all data

**API Compatibility:**
- No API changes required
- Encryption/decryption happens server-side
- Transparent to clients

## Alternatives Considered

### Alternative 1: Per-User Keys
**Pros:** Better isolation
**Cons:** Complex key management, slower performance
**Decision:** Too complex for current needs

### Alternative 2: AWS KMS
**Pros:** Managed service, automatic rotation
**Cons:** Cloud-only, vendor lock-in, cost
**Decision:** Not suitable for self-hosted deployments

### Alternative 3: HashiCorp Vault
**Pros:** Industry standard, feature-rich
**Cons:** Additional infrastructure, operational complexity
**Decision:** Too heavyweight for most deployments

## Open Questions

1. **Rotation Frequency:** Default to 90 days? Configurable?
2. **Master Key:** Where to store the master key that encrypts encryption keys?
3. **Compliance:** Which standards to target (SOC 2, HIPAA, etc.)?
4. **Performance:** Impact of key lookup on encryption/decryption?

## Success Criteria

- [ ] Can rotate encryption keys without downtime
- [ ] All encrypted data has associated keyId
- [ ] Rotation completes in <1 hour for 1M records
- [ ] No data loss during rotation
- [ ] Monitoring alerts for key expiration
- [ ] Documentation for operators

## Security Considerations

- **Master Key Protection:** Master key must be more secure than individual keys
- **Rotation Window:** Minimize time where both old and new keys are active
- **Audit Logging:** Log all key operations (creation, rotation, access)
- **Access Control:** Restrict key management to admins only

## Estimated Impact

- **Security:** High - Reduces blast radius of key compromise
- **Compliance:** High - Enables meeting rotation requirements
- **Performance:** Low - Minimal overhead (<1ms per operation)
- **Development Effort:** 2-3 weeks
- **Maintenance:** Low - Mostly automated

