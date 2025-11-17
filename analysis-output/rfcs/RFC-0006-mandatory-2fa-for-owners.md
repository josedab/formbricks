# RFC-0006: Mandatory Two-Factor Authentication for Organization Owners

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Medium (Long-term)  
**Effort:** 2 weeks

## Summary

Enforce two-factor authentication (2FA) for organization owners to protect against account compromise and unauthorized access to sensitive organization settings, billing, and data.

## Motivation

**Current State:**
- 2FA available but optional for all users
- No enforcement mechanism
- Organization owners have full access (billing, member management, data deletion)

**Security Risk:**
- Compromised owner account = full organization compromise
- Phishing attacks can bypass password-only auth
- Compliance requirements (SOC 2, ISO 27001) often mandate 2FA for privileged accounts

**Industry Standards:**
- GitHub enforces 2FA for organization owners
- AWS requires MFA for root accounts
- Most enterprise SaaS platforms mandate 2FA for admins

## Detailed Design

### Enforcement Flow

**1. Organization Owner Promotion:**
```typescript
// When user becomes owner
export const promoteToOwnerAction = authenticatedActionClient
  .schema(ZPromoteToOwnerInput)
  .action(async ({ ctx, parsedInput }) => {
    const user = await getUser(parsedInput.userId);
    
    // Check if user has 2FA enabled
    if (!user.twoFactorEnabled) {
      throw new Error(
        "User must enable 2FA before becoming an organization owner. " +
        "Please ask them to enable 2FA in their account settings first."
      );
    }
    
    // Proceed with promotion
    await updateMembership(parsedInput.membershipId, {
      role: "owner"
    });
  });
```

**2. Existing Owners Grace Period:**
```typescript
// Database migration
model Organization {
  id                    String   @id
  twoFactorEnforcedAt   DateTime?  // When 2FA became required
  twoFactorGracePeriod  Int       @default(30) // Days
}

model Membership {
  id                String   @id
  role              MembershipRole
  twoFactorWarned   Boolean  @default(false)
  twoFactorDeadline DateTime?
}
```

**3. Login Check for Owners:**
```typescript
// middleware.ts or auth callback
export async function checkOwner2FACompliance(userId: string) {
  const memberships = await prisma.membership.findMany({
    where: { userId, role: "owner" },
    include: { organization: true }
  });
  
  if (memberships.length === 0) return; // Not an owner
  
  const user = await getUser(userId);
  
  if (user.twoFactorEnabled) return; // Compliant
  
  // Check grace period
  for (const membership of memberships) {
    if (!membership.twoFactorDeadline) {
      // Set deadline
      await prisma.membership.update({
        where: { id: membership.id },
        data: {
          twoFactorDeadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          twoFactorWarned: false
        }
      });
    }
    
    const deadline = membership.twoFactorDeadline;
    const daysRemaining = Math.ceil(
      (deadline.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
    );
    
    if (daysRemaining <= 0) {
      // Demote to manager
      await prisma.membership.update({
        where: { id: membership.id },
        data: { role: "manager" }
      });
      
      await sendEmail({
        to: user.email,
        subject: "You've been demoted from organization owner",
        template: "owner-demoted-no-2fa",
        data: {
          organizationName: membership.organization.name,
          reason: "2FA not enabled within grace period"
        }
      });
    } else if (daysRemaining <= 7 && !membership.twoFactorWarned) {
      // Warning
      await sendEmail({
        to: user.email,
        subject: `Action Required: Enable 2FA in ${daysRemaining} days`,
        template: "2fa-reminder",
        data: { daysRemaining, organizationName: membership.organization.name }
      });
      
      await prisma.membership.update({
        where: { id: membership.id },
        data: { twoFactorWarned: true }
      });
    }
  }
}
```

### UI/UX Implementation

**1. Banner for Owners Without 2FA:**
```typescript
// components/2FAEnforcementBanner.tsx
export function TwoFactorEnforcementBanner({ user, membership }: Props) {
  if (user.twoFactorEnabled) return null;
  if (membership.role !== "owner") return null;
  
  const daysRemaining = calculateDaysRemaining(membership.twoFactorDeadline);
  const urgency = daysRemaining <= 3 ? "error" : daysRemaining <= 7 ? "warning" : "info";
  
  return (
    <Alert variant={urgency}>
      <Shield className="h-4 w-4" />
      <AlertTitle>Two-Factor Authentication Required</AlertTitle>
      <AlertDescription>
        As an organization owner, you must enable 2FA within {daysRemaining} days.
        After this period, you'll be demoted to Manager role.
        
        <Button asChild className="mt-2">
          <Link href="/settings/security">Enable 2FA Now</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
```

**2. 2FA Setup Wizard:**
```typescript
// Streamlined setup flow
const steps = [
  {
    title: "Why 2FA?",
    description: "Two-factor authentication adds an extra layer of security...",
  },
  {
    title: "Scan QR Code",
    component: <QRCodeDisplay secret={secret} />,
  },
  {
    title: "Verify Code",
    component: <TOTPVerification />,
  },
  {
    title: "Save Backup Codes",
    component: <BackupCodes codes={backupCodes} />,
    critical: true, // Must download before continuing
  },
];
```

**3. Admin Dashboard:**
```typescript
// Organization settings - 2FA compliance view
export function TwoFactorCompliancePanel({ organizationId }: Props) {
  const members = useMembers(organizationId);
  const owners = members.filter(m => m.role === "owner");
  const compliantOwners = owners.filter(m => m.user.twoFactorEnabled);
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>Two-Factor Authentication Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <Progress value={(compliantOwners.length / owners.length) * 100} />
          <p className="text-sm text-muted-foreground mt-2">
            {compliantOwners.length} of {owners.length} owners have 2FA enabled
          </p>
        </div>
        
        {owners.map(owner => (
          <div key={owner.id} className="flex items-center justify-between py-2">
            <div>
              <p className="font-medium">{owner.user.name}</p>
              <p className="text-sm text-muted-foreground">{owner.user.email}</p>
            </div>
            <Badge variant={owner.user.twoFactorEnabled ? "success" : "destructive"}>
              {owner.user.twoFactorEnabled ? (
                <><Check className="w-3 h-3 mr-1" /> Enabled</>
              ) : (
                <><X className="w-3 h-3 mr-1" /> Not Enabled</>
              )}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

### Configuration Options

**Organization-level Settings:**
```typescript
model OrganizationSecurity {
  id                      String   @id
  organizationId          String   @unique
  
  // 2FA policies
  enforce2FAForOwners     Boolean  @default(true)
  enforce2FAForManagers   Boolean  @default(false)
  enforce2FAForAll        Boolean  @default(false)
  gracePeriodDays         Int      @default(30)
  
  // Session policies
  sessionTimeoutMinutes   Int      @default(1440) // 24 hours
  
  createdAt               DateTime @default(now())
  updatedAt               DateTime @updatedAt
}
```

**Future Expansion:**
- Enforce for managers (optional)
- Enforce for all members (optional)
- Custom grace periods per organization

## Implementation Plan

**Week 1:**
- [ ] Database schema changes
- [ ] Enforcement logic implementation
- [ ] Grace period tracking

**Week 2:**
- [ ] UI/UX components (banner, wizard)
- [ ] Email templates (warnings, demotions)
- [ ] Admin dashboard compliance view
- [ ] Migration for existing organizations
- [ ] Documentation

**Week 3:**
- [ ] Testing (unit, integration, e2e)
- [ ] Rollout plan
- [ ] Monitoring and alerts

**Week 4:**
- [ ] Staged rollout (10% → 50% → 100% of orgs)
- [ ] Monitor support tickets
- [ ] Adjustments based on feedback

## Rollout Strategy

**Phase 1: Opt-in (Month 1)**
- New feature flag: `ENFORCE_2FA_FOR_OWNERS`
- Organizations can enable voluntarily
- Gather feedback, fix bugs

**Phase 2: New Organizations (Month 2)**
- All new organizations have enforcement enabled by default
- Existing organizations notified of upcoming change

**Phase 3: Existing Organizations (Month 3-4)**
- Gradual rollout to existing organizations
- 30-day grace period for each org
- Communication plan:
  - Email to all owners (3 weeks before)
  - In-app banner (2 weeks before)
  - Email reminder (1 week before)
  - Final reminder (3 days before)

**Phase 4: Full Enforcement (Month 5)**
- All organizations enforced
- Monitor demotion rate, support tickets

## Backwards Compatibility

**Existing Owners:**
- 30-day grace period
- Clear communication
- Easy 2FA setup process
- Support documentation

**API/CLI Users:**
- API keys not affected (separate auth method)
- CLI can use API keys
- OAuth tokens respect 2FA

## Alternatives Considered

### Alternative 1: Soft Enforcement (Warnings Only)
**Pros:** Less disruptive
**Cons:** Low adoption, security risk remains
**Decision:** Hard enforcement needed for security

### Alternative 2: Immediate Enforcement
**Pros:** Maximum security
**Cons:** User backlash, support burden
**Decision:** Grace period balances security and UX

### Alternative 3: Enforce for All Users
**Pros:** Strongest security
**Cons:** High friction for small teams
**Decision:** Start with owners, expand later

## User Communication

**Email Template (Initial Notification):**
```
Subject: Important: Two-Factor Authentication Required for Organization Owners

Hi [Name],

We're enhancing security for Formbricks organizations by requiring two-factor authentication (2FA) for all organization owners.

What you need to do:
1. Enable 2FA in your account settings within 30 days
2. Download your backup codes (in case you lose your device)

Why this matters:
- Organization owners have full access to billing, data, and settings
- 2FA protects against account takeover and phishing attacks
- This is a standard security practice (GitHub, AWS, etc. require it)

Timeline:
- Today: 30-day grace period begins
- [Date + 23 days]: Reminder email
- [Date + 30 days]: If 2FA not enabled, you'll be demoted to Manager role

Enable 2FA now: [Link to Security Settings]

Questions? Check our 2FA guide: [Link] or contact support.

Thanks for helping keep Formbricks secure!
The Formbricks Team
```

## Success Criteria

- [ ] 100% of organization owners have 2FA enabled (after grace period)
- [ ] <5% demotion rate (most enable 2FA proactively)
- [ ] <10 support tickets per 1000 owners
- [ ] Clear documentation and setup flow
- [ ] No security incidents due to compromised owner accounts

## Security Considerations

1. **Backup Codes:**
   - Force download before completing setup
   - Regenerate on demand
   - Track usage (alert on suspicious activity)

2. **Account Recovery:**
   - Support team can disable 2FA after identity verification
   - Alternative: Other owners can remove/re-add member

3. **Session Management:**
   - 2FA re-prompt for sensitive actions (billing, member removal)
   - Shorter session timeout for owners

## Monitoring

**Metrics to Track:**
- % owners with 2FA enabled
- Grace period expiration rate
- Demotion rate
- Support ticket volume
- Account compromise incidents

**Alerts:**
- Spike in demotions (potential UX issue)
- Spike in 2FA disablements (potential attack)
- Low adoption rate (communication issue)

## Estimated Impact

- **Security:** High - Significantly reduces account takeover risk
- **User Impact:** Medium - Some friction, but necessary
- **Development Effort:** 2-3 weeks
- **Support Load:** Medium initially, low after rollout

## References

- [GitHub 2FA Requirement](https://github.blog/2023-03-09-raising-the-bar-for-software-security-github-2fa-begins-march-13/)
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)
