# RFC-0007: ESLint 9 Migration

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Medium (Strategic)  
**Effort:** 1 week

## Summary

Migrate from ESLint 8.57.0 to ESLint 9.x to leverage modern linting features, improved performance, and stay current with tooling ecosystem.

## Motivation

**Current State:**
- ESLint 8.57.0 (released early 2024)
- ESLint 9.0 released April 2024
- Using legacy `.eslintrc.cjs` format

**Why Upgrade:**
1. **Modern Features:** Flat config format, better TypeScript support
2. **Performance:** Faster linting (30-50% improvement)
3. **Ecosystem:** New plugins require ESLint 9
4. **Support:** ESLint 8 will eventually be EOL
5. **Developer Experience:** Better error messages, auto-fixing

**Breaking Changes in ESLint 9:**
- Flat config format (mandatory)
- Removed formatters
- Changed plugin API
- Node.js 18.18+ required

## Detailed Design

### New Flat Config Format

**Current Structure:**
```javascript
// .eslintrc.cjs
module.exports = {
  extends: ["@formbricks/eslint-config/next"],
  parserOptions: {
    project: "./tsconfig.json",
  },
  overrides: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      rules: { ... }
    }
  ]
};
```

**New Structure:**
```javascript
// eslint.config.mjs
import formbricksConfig from "@formbricks/eslint-config/next";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/.turbo/**"
    ],
  },
  ...formbricksConfig,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      // ... other rules
    },
  },
];
```

### Package Updates

**Dependencies to Update:**
```json
{
  "devDependencies": {
    "eslint": "^9.0.0",               // was: 8.57.0
    "typescript-eslint": "^8.0.0",    // new: replaces @typescript-eslint/*
    "@vercel/style-guide": "^6.0.0",  // update for ESLint 9 compat
    "eslint-config-next": "^15.0.0",  // update for Next.js 15
    "eslint-plugin-vitest": "^0.5.0"  // update
  }
}
```

**Migration Path:**
```bash
# Remove old packages
pnpm remove @typescript-eslint/eslint-plugin @typescript-eslint/parser

# Add new packages
pnpm add -D eslint@^9.0.0 typescript-eslint@^8.0.0

# Update config packages
pnpm add -D @vercel/style-guide@^6.0.0 eslint-config-next@^15.0.0
```

### Config Package Updates

**`packages/config-eslint/next.js`:**
```javascript
// Before (ESLint 8)
module.exports = {
  extends: [
    "@vercel/style-guide/eslint/node",
    "@vercel/style-guide/eslint/typescript",
    "@vercel/style-guide/eslint/browser",
    "@vercel/style-guide/eslint/react",
    "@vercel/style-guide/eslint/next",
  ],
  plugins: ["@vitest"],
  rules: {
    "@vitest/consistent-test-it": ["error", { fn: "test", withinDescribe: "test" }],
  },
};

// After (ESLint 9)
import vercelNode from "@vercel/style-guide/eslint/node";
import vercelTypeScript from "@vercel/style-guide/eslint/typescript";
import vercelBrowser from "@vercel/style-guide/eslint/browser";
import vercelReact from "@vercel/style-guide/eslint/react";
import vercelNext from "@vercel/style-guide/eslint/next";
import vitest from "eslint-plugin-vitest";

export default [
  ...vercelNode,
  ...vercelTypeScript,
  ...vercelBrowser,
  ...vercelReact,
  ...vercelNext,
  {
    plugins: {
      vitest,
    },
    rules: {
      "vitest/consistent-test-it": [
        "error",
        { fn: "test", withinDescribe: "test" },
      ],
    },
  },
];
```

### Workspace-specific Configs

**Per-package overrides:**
```javascript
// apps/web/eslint.config.mjs
import rootConfig from "../../eslint.config.mjs";

export default [
  ...rootConfig,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
```

### Migration Script

```typescript
// scripts/migrate-eslint.ts
import fs from "fs";
import path from "path";
import { glob } from "glob";

async function migrateESLintConfigs() {
  const eslintrcFiles = await glob("**/.eslintrc.{js,cjs,json}", {
    ignore: ["**/node_modules/**"],
  });

  for (const file of eslintrcFiles) {
    const dir = path.dirname(file);
    const newConfigPath = path.join(dir, "eslint.config.mjs");

    console.log(`Migrating ${file} to ${newConfigPath}`);

    // Read old config
    const oldConfig = require(path.resolve(file));

    // Convert to flat config
    const newConfig = convertToFlatConfig(oldConfig);

    // Write new config
    fs.writeFileSync(
      newConfigPath,
      `export default ${JSON.stringify(newConfig, null, 2)};`
    );

    // Delete old config
    fs.unlinkSync(file);
  }

  console.log("Migration complete!");
}

function convertToFlatConfig(oldConfig: any): any[] {
  // Conversion logic
  const flatConfig = [];

  if (oldConfig.extends) {
    // Convert extends to imports
  }

  if (oldConfig.rules) {
    flatConfig.push({
      rules: oldConfig.rules,
    });
  }

  if (oldConfig.overrides) {
    // Convert overrides to separate configs
    oldConfig.overrides.forEach((override) => {
      flatConfig.push({
        files: override.files,
        rules: override.rules,
      });
    });
  }

  return flatConfig;
}

migrateESLintConfigs();
```

### VSCode Integration

**.vscode/settings.json:**
```json
{
  "eslint.experimental.useFlatConfig": true,
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact"
  ],
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

## Implementation Plan

**Day 1:**
- [ ] Update ESLint and TypeScript-ESLint in root
- [ ] Convert root eslint.config.mjs
- [ ] Update config-eslint package
- [ ] Test on sample files

**Day 2-3:**
- [ ] Update all workspace package configs
- [ ] Run migration script
- [ ] Fix any linting errors that appear
- [ ] Update CI/CD scripts

**Day 4:**
- [ ] Update documentation (CONTRIBUTING.md)
- [ ] Update VSCode settings
- [ ] Test pre-commit hooks
- [ ] Verify Turbo caching still works

**Day 5:**
- [ ] Team review and testing
- [ ] Fix any edge cases
- [ ] Deploy to CI/CD
- [ ] Monitor for issues

## Testing Strategy

**1. Baseline Comparison:**
```bash
# Before migration
pnpm lint > lint-before.txt 2>&1

# After migration
pnpm lint > lint-after.txt 2>&1

# Compare
diff lint-before.txt lint-after.txt
```

**2. Incremental Testing:**
- Test one package at a time
- Ensure no new errors introduced
- Verify auto-fix still works

**3. CI/CD Verification:**
- Ensure lint step passes
- Check performance improvement
- Verify cache invalidation

## Backwards Compatibility

**No Backwards Compatibility:**
- ESLint 8 and 9 configs are incompatible
- Must migrate all configs at once
- Update all developer machines

**Team Communication:**
```
📢 Action Required: ESLint 9 Upgrade

We're upgrading to ESLint 9 on [Date].

What you need to do:
1. Pull latest changes
2. Run: pnpm install
3. Restart VSCode (or reload window)

What's changing:
- New config format (eslint.config.mjs)
- Faster linting (~30% improvement)
- Better TypeScript support

Questions? See: docs/eslint-9-migration.md
```

## Success Criteria

- [ ] All packages using ESLint 9
- [ ] All `.eslintrc.*` files removed
- [ ] Lint passes in CI/CD
- [ ] No degradation in linting quality
- [ ] Performance improvement measured
- [ ] Team trained on new config format

## Rollback Plan

If issues arise:
```bash
# Revert commit
git revert [migration-commit]

# Reinstall dependencies
pnpm install

# Clear caches
rm -rf .eslint-cache .turbo node_modules/.cache
```

## Performance Improvements

**Expected:**
- Lint time: 45s → ~30s (33% faster)
- Better caching
- Faster startup time

**Measurement:**
```bash
# Before
time pnpm lint

# After
time pnpm lint
```

## Estimated Impact

- **Developer Experience:** High - Faster linting, better errors
- **Code Quality:** Same (no regression)
- **Development Effort:** 1 week
- **Team Training:** 1 hour
- **Risk:** Medium (can revert if needed)

## References

- [ESLint 9 Migration Guide](https://eslint.org/docs/latest/use/migrate-to-9.0.0)
- [TypeScript-ESLint v8](https://typescript-eslint.io/blog/announcing-typescript-eslint-v8)
- [Flat Config Guide](https://eslint.org/docs/latest/use/configure/configuration-files)
