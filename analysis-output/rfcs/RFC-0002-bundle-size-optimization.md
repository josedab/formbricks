# RFC-0002: Bundle Size Optimization

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** High (Quick Win)  
**Effort:** 3-5 days

## Summary

Reduce Next.js client bundle size by 15-20% through lodash replacement, dynamic imports, and tree-shaking improvements.

## Motivation

**Current State:**
- First Load JS: ~350KB (budget: 358KB)
- Using `lodash@4.17.21` (potentially not tree-shaken)
- Heavy components loaded eagerly
- Framer Motion adds ~60KB

**Problems:**
1. **Performance:** Larger bundles = slower page loads
2. **Mobile Users:** High data costs for 350KB+ downloads
3. **Budget Risk:** Close to 358KB limit, future additions may exceed

## Detailed Design

### 1. Replace Lodash with Native Methods

**Current Usage Analysis:**
```bash
grep -r "import.*lodash" apps/web | wc -l
# Result: ~45 files using lodash
```

**Common Patterns:**
```typescript
// Before
import _ from "lodash";
const grouped = _.groupBy(items, "category");
const unique = _.uniq(array);
const debounced = _.debounce(fn, 300);

// After
const grouped = Object.groupBy(items, (item) => item.category);
const unique = [...new Set(array)];
import { debounce } from "@/lib/utils/debounce"; // 10 lines, no dependency
```

**Estimated Savings:** 40KB minified+gzipped

### 2. Dynamic Imports for Heavy Components

**Lexical Editor** (~150KB):
```typescript
// Before
import { LexicalEditor } from "@lexical/react";

// After
const LexicalEditor = dynamic(() => import("@lexical/react"), {
  loading: () => <EditorSkeleton />,
  ssr: false
});
```

**Chart Components:**
```typescript
const ChartComponent = dynamic(() => import("./Chart"), {
  loading: () => <Spinner />,
  ssr: false
});
```

**Estimated Savings:** 100KB (loaded only when needed)

### 3. Optimize Framer Motion

**Current:**
```typescript
import { motion } from "framer-motion";
```

**Option A:** Use `@formkit/auto-animate` (already in surveys package, 5KB)
```typescript
import { useAutoAnimate } from "@formkit/auto-animate/react";
```

**Option B:** CSS Animations
```css
@keyframes slideIn {
  from { transform: translateY(-10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

**Estimated Savings:** 40KB

### 4. Tree-Shaking Improvements

**Radix UI** - Already good, but verify:
```typescript
// Ensure imports are granular
import { Dialog } from "@radix-ui/react-dialog"; // ✅ Good
import * as Dialog from "@radix-ui/react-dialog"; // ❌ May import more
```

## Implementation Plan

**Day 1:**
- [ ] Audit lodash usage (`grep -r "from 'lodash'"`)
- [ ] Create utility functions for common patterns
- [ ] Document migration guide

**Day 2-3:**
- [ ] Replace lodash in 45 files
- [ ] Run tests after each replacement
- [ ] Verify bundle size reduction

**Day 4:**
- [ ] Implement dynamic imports for Lexical
- [ ] Add loading skeletons
- [ ] Test lazy loading behavior

**Day 5:**
- [ ] Evaluate Framer Motion alternatives
- [ ] Implement chosen solution
- [ ] Final bundle analysis
- [ ] Performance testing

## Success Criteria

- [ ] Bundle size reduced by ≥15% (from 350KB to ≤297KB)
- [ ] All tests passing
- [ ] No performance regressions (Lighthouse score)
- [ ] Lazy-loaded components render correctly

## Measurement

**Before:**
```bash
pnpm build
# Analyze .next/static/chunks
```

**After:**
```bash
pnpm build
# Compare bundle sizes
# Expected: First Load JS ~297KB (-53KB)
```

