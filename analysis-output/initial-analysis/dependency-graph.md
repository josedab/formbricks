# Formbricks Dependency Analysis

**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## Key Findings

**Total Dependencies:** ~200 unique packages
**Security Status:** ✅ 0 critical vulnerabilities (patched)
**Version Strategy:** Exact pinning (no ^ or ~)
**Monorepo:** 13 workspace packages

## Critical Dependencies

### Framework Stack
- `next@15.5.6` - ✅ Latest, React Server Components
- `react@19.1.0` - ✅ Cutting edge
- `prisma@6.14.0` - ✅ Latest ORM
- `typescript@5.8.3` - ✅ Latest

### Issues Identified

1. **Redis Version Mismatch**
   - apps/web: `4.7.0`
   - packages/cache: `5.8.1`
   - **Action:** Upgrade web to 5.x

2. **ESLint Outdated**
   - Current: `8.57.0`
   - Latest: `9.x`
   - **Action:** Plan migration to v9

3. **Bundle Size Opportunities**
   - `lodash` - Replace with native methods
   - `framer-motion` - Consider lighter alternatives
   - **Impact:** 15-20% bundle reduction

## Security Patches Applied

```json
"overrides": {
  "axios": ">=1.12.2",  // CVE-2025-58754
  "tar-fs": "2.1.4"     // Dependabot #205
}
```

## Internal Dependencies

```
apps/web → all packages
packages/surveys → types, i18n-utils
packages/database → logger
packages/cache → logger
packages/storage → logger
```

## Recommendations

1. **Immediate:** Standardize Redis version (30 min)
2. **Short-term:** Lodash audit and replacement (4 hours)
3. **Medium-term:** ESLint 9 migration (1 week)

See full analysis for complete dependency breakdown.
