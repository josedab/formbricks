# RFC-0005: Increase Test Coverage to 40%

**Status:** Draft  
**Author:** Analysis Team  
**Created:** 2025-11-16  
**Priority:** Medium (Strategic)  
**Effort:** 2-3 months (ongoing)

## Summary

Systematically increase test coverage from current 18% to 40% over 2-3 months, focusing on high-value areas: service layer business logic, API endpoints, and complex survey logic evaluation.

## Motivation

**Current State:**
- Total test files: 347
- Total source files: ~1,918
- Test coverage: ~18%
- Industry standard: 40-80%

**Problems:**
1. **Confidence:** Lower confidence when refactoring
2. **Regressions:** Bugs slip through without adequate test coverage
3. **Documentation:** Tests serve as living documentation
4. **Onboarding:** New contributors lack test examples
5. **Velocity:** Fear of breaking things slows development

**Coverage Breakdown:**
```
Packages with good coverage:
- surveys package: ~40% ✅
- js-core package: ~35% ✅
- cache package: ~30% ✅

Packages with poor coverage:
- apps/web: ~15% ❌
- database package: 0% ❌ (migrations untested)
- types package: 0% ❌ (acceptable - pure types)
```

## Detailed Design

### Phase 1: Infrastructure (Week 1-2)

**1. Centralized Vitest Configuration**

```typescript
// vitest.workspace.ts (root)
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    test: {
      name: "unit",
      include: ["**/*.test.ts"],
      environment: "node",
      coverage: {
        provider: "v8",
        reporter: ["text", "json", "html"],
        exclude: [
          "**/*.test.ts",
          "**/*.spec.ts",
          "**/node_modules/**",
          "**/dist/**",
        ],
      },
    },
  },
  {
    test: {
      name: "integration",
      include: ["**/*.integration.test.ts"],
      environment: "node",
      setupFiles: ["./test/integration-setup.ts"],
    },
  },
]);
```

**2. Shared Test Utilities Package**

```typescript
// packages/test-utils/src/factories/survey-factory.ts
export const createTestSurvey = (overrides?: Partial<TSurvey>): TSurvey => ({
  id: "test_survey_1",
  name: "Test Survey",
  type: "link",
  status: "inProgress",
  questions: [createTestQuestion()],
  ...overrides,
});

export const createTestQuestion = (
  overrides?: Partial<TSurveyQuestion>
): TSurveyQuestion => ({
  id: "q1",
  type: "openText",
  headline: { default: "What do you think?" },
  required: false,
  ...overrides,
});

export const createTestResponse = (
  overrides?: Partial<TResponse>
): TResponse => ({
  id: "response_1",
  surveyId: "test_survey_1",
  data: { q1: "Great product!" },
  finished: true,
  ...overrides,
});
```

**3. Mock Standardization**

```typescript
// packages/test-utils/src/mocks/prisma.ts
import { PrismaClient } from "@prisma/client";
import { mockDeep, mockReset, DeepMockProxy } from "vitest-mock-extended";

export const prismaMock = mockDeep<PrismaClient>();

beforeEach(() => {
  mockReset(prismaMock);
});

// packages/test-utils/src/mocks/redis.ts
export const redisMock = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  exists: vi.fn(),
};
```

### Phase 2: Service Layer Testing (Week 3-6)

**Priority: High-value business logic**

**Target Files:**
- `apps/web/lib/survey/service.ts`
- `apps/web/lib/response/service.ts`
- `apps/web/lib/contact/service.ts`
- `apps/web/lib/segment/service.ts`

**Test Template:**

```typescript
// apps/web/lib/survey/__tests__/service.test.ts
import { describe, test, expect, beforeEach, vi } from "vitest";
import { prismaMock } from "@formbricks/test-utils/mocks";
import { createTestSurvey } from "@formbricks/test-utils/factories";
import { getSurvey, createSurvey, updateSurvey } from "../service";

vi.mock("@/lib/database", () => ({
  prisma: prismaMock,
}));

describe("Survey Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getSurvey", () => {
    describe("Happy Path", () => {
      test("returns survey when found", async () => {
        const mockSurvey = createTestSurvey();
        prismaMock.survey.findUnique.mockResolvedValue(mockSurvey);

        const result = await getSurvey("survey_123");

        expect(result).toEqual(mockSurvey);
        expect(prismaMock.survey.findUnique).toHaveBeenCalledWith({
          where: { id: "survey_123" },
        });
      });
    });

    describe("Sad Path", () => {
      test("returns null when survey not found", async () => {
        prismaMock.survey.findUnique.mockResolvedValue(null);

        const result = await getSurvey("nonexistent");

        expect(result).toBeNull();
      });

      test("throws DatabaseError on Prisma error", async () => {
        prismaMock.survey.findUnique.mockRejectedValue(
          new Error("Connection failed")
        );

        await expect(getSurvey("survey_123")).rejects.toThrow(DatabaseError);
      });
    });

    describe("Input Validation", () => {
      test("throws ValidationError for invalid ID format", async () => {
        await expect(getSurvey("")).rejects.toThrow(ValidationError);
        await expect(getSurvey(null as any)).rejects.toThrow(ValidationError);
      });
    });
  });

  describe("createSurvey", () => {
    test("creates survey with valid input", async () => {
      const input = {
        name: "Customer Satisfaction",
        type: "link" as const,
        questions: [createTestQuestion()],
      };
      const mockCreated = createTestSurvey(input);
      
      prismaMock.survey.create.mockResolvedValue(mockCreated);

      const result = await createSurvey(input);

      expect(result).toEqual(mockCreated);
      expect(prismaMock.survey.create).toHaveBeenCalledWith({
        data: expect.objectContaining(input),
      });
    });

    test("generates CUID for new survey", async () => {
      const input = { name: "Test", type: "link" as const, questions: [] };
      
      prismaMock.survey.create.mockResolvedValue(
        createTestSurvey({ id: "clx123abc" })
      );

      const result = await createSurvey(input);

      expect(result.id).toMatch(/^cl[a-z0-9]{21,25}$/);
    });
  });
});
```

**Coverage Target per File:** >60%

### Phase 3: API Integration Testing (Week 7-9)

**Test API Routes:**

```typescript
// apps/web/app/api/v2/management/surveys/__tests__/route.integration.test.ts
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { createTestEnvironment, cleanupTestData } from "@formbricks/test-utils";

describe("Survey Management API (v2)", () => {
  let testEnv: TestEnvironment;
  let apiKey: string;

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
    apiKey = testEnv.apiKey;
  });

  afterAll(async () => {
    await cleanupTestData(testEnv.organizationId);
  });

  describe("POST /api/v2/management/surveys", () => {
    test("creates survey with valid API key", async () => {
      const response = await fetch("http://localhost:3000/api/v2/management/surveys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          name: "Integration Test Survey",
          type: "link",
          questions: [
            {
              type: "openText",
              headline: { default: "Feedback?" },
            },
          ],
        }),
      });

      expect(response.status).toBe(201);
      const survey = await response.json();
      expect(survey).toMatchObject({
        name: "Integration Test Survey",
        type: "link",
      });
    });

    test("returns 401 without API key", async () => {
      const response = await fetch("http://localhost:3000/api/v2/management/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test" }),
      });

      expect(response.status).toBe(401);
    });

    test("returns 400 for invalid input", async () => {
      const response = await fetch("http://localhost:3000/api/v2/management/surveys", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({ name: "" }), // Invalid: empty name
      });

      expect(response.status).toBe(400);
    });
  });
});
```

### Phase 4: Complex Logic Testing (Week 10-12)

**Survey Logic Evaluation:**

```typescript
// apps/web/lib/survey-logic/__tests__/evaluator.test.ts
describe("Survey Logic Evaluator", () => {
  describe("Jump Logic", () => {
    test("jumps to correct question based on answer", () => {
      const survey = createTestSurvey({
        questions: [
          {
            id: "q1",
            type: "multipleChoiceSingle",
            choices: [
              { id: "yes", label: { default: "Yes" } },
              { id: "no", label: { default: "No" } },
            ],
            logic: [
              {
                condition: { type: "equals", value: "no" },
                destination: "q3", // Skip q2
              },
            ],
          },
          { id: "q2", type: "openText" },
          { id: "q3", type: "rating" },
        ],
      });

      const response = { q1: "no" };
      const nextQuestion = evaluateNextQuestion(survey, "q1", response);

      expect(nextQuestion?.id).toBe("q3");
    });
  });

  describe("Variable Calculations", () => {
    test("calculates score correctly", () => {
      const variables = {
        score: { type: "number", value: 0 },
      };
      
      const logic = {
        type: "calculate",
        variableId: "score",
        operation: "add",
        operand: 10,
      };

      const result = evaluateLogic(logic, {}, variables);

      expect(result.score.value).toBe(10);
    });

    test("concatenates text variables", () => {
      const variables = {
        fullName: { type: "text", value: "" },
      };
      
      const response = { firstName: "John", lastName: "Doe" };
      const logic = {
        type: "calculate",
        variableId: "fullName",
        operation: "concat",
        operands: ["{{firstName}}", " ", "{{lastName}}"],
      };

      const result = evaluateLogic(logic, response, variables);

      expect(result.fullName.value).toBe("John Doe");
    });
  });
});
```

### Testing Standards

**1. Test Naming Convention:**
```typescript
describe("ComponentName / FunctionName", () => {
  describe("Happy Path", () => {
    test("does expected behavior with valid input", () => {});
  });
  
  describe("Sad Path", () => {
    test("handles error gracefully", () => {});
  });
  
  describe("Edge Cases", () => {
    test("handles boundary condition", () => {});
  });
  
  describe("Input Validation", () => {
    test("rejects invalid input", () => {});
  });
});
```

**2. Assertion Best Practices:**
```typescript
// ✅ Good: Specific assertions
expect(result).toEqual({ id: "123", name: "Test" });
expect(result.id).toMatch(/^cl[a-z0-9]+$/);
expect(mockFn).toHaveBeenCalledWith(expect.objectContaining({ ... }));

// ❌ Bad: Vague assertions
expect(result).toBeTruthy();
expect(result).toBeDefined();
```

**3. Test Data Management:**
```typescript
// ✅ Good: Use factories
const survey = createTestSurvey({ name: "Custom" });

// ❌ Bad: Inline test data
const survey = {
  id: "test",
  name: "test",
  type: "link",
  // ... 50 more fields
};
```

## Implementation Plan

### Month 1: Foundation
**Week 1-2:**
- [ ] Create test-utils package
- [ ] Implement factories for all domain objects
- [ ] Standardize mock implementations
- [ ] Configure centralized Vitest setup

**Week 3-4:**
- [ ] Test 10 core service functions
- [ ] Achieve 30% coverage in service layer
- [ ] Document testing patterns

### Month 2: Expansion
**Week 5-6:**
- [ ] Test 15 more service functions
- [ ] Add integration tests for 5 API routes
- [ ] Achieve 25% overall coverage

**Week 7-8:**
- [ ] Test complex survey logic
- [ ] Add tests for segment evaluation
- [ ] Test authentication flows

### Month 3: Refinement
**Week 9-10:**
- [ ] Fill gaps to reach 40% overall
- [ ] Add missing edge case tests
- [ ] Performance test critical paths

**Week 11-12:**
- [ ] Documentation and examples
- [ ] Team training on testing patterns
- [ ] CI/CD enforcement of coverage thresholds

## Success Criteria

- [ ] Overall coverage: ≥40%
- [ ] Service layer coverage: ≥60%
- [ ] API routes coverage: ≥50%
- [ ] Complex logic coverage: ≥70%
- [ ] All new code requires tests (CI check)
- [ ] Coverage doesn't decrease (ratcheting)

## CI/CD Integration

```yaml
# .github/workflows/test-coverage.yml
name: Test Coverage

on: [pull_request]

jobs:
  coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - name: Install dependencies
        run: pnpm install
      
      - name: Run tests with coverage
        run: pnpm test:coverage
      
      - name: Check coverage threshold
        uses: codecov/codecov-action@v3
        with:
          fail_ci_if_error: true
          files: ./coverage/coverage-final.json
      
      - name: Coverage ratchet
        run: |
          CURRENT=$(jq '.total.lines.pct' coverage/coverage-summary.json)
          BASELINE=40
          if (( $(echo "$CURRENT < $BASELINE" | bc -l) )); then
            echo "Coverage $CURRENT% is below threshold $BASELINE%"
            exit 1
          fi
```

## Team Training

**1. Testing Workshop (2 hours):**
- Why we test
- Testing pyramid (unit > integration > e2e)
- Writing good tests
- Using factories and mocks

**2. Documentation:**
- Testing guide in CONTRIBUTING.md
- Example tests for each pattern
- Common pitfalls and solutions

**3. Pair Programming:**
- Senior devs pair with juniors on first tests
- Code review focus on test quality

## Estimated Impact

- **Quality:** High - Catch bugs earlier
- **Velocity:** Medium - Initial slowdown, long-term speedup
- **Confidence:** High - Fearless refactoring
- **Development Effort:** 2-3 months
- **Maintenance:** Medium - Tests need updating with code

## Metrics to Track

```typescript
// Weekly tracking
{
  week: 1,
  overallCoverage: 18,
  serviceLayerCoverage: 15,
  newTestsAdded: 25,
  testRuntime: "45s",
}
```

**Dashboard:** Track progress weekly, celebrate milestones

