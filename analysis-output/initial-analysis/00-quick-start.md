# Formbricks Codebase Analysis - Quick Start Guide

**Analysis Date:** 2025-11-16
**Commit SHA:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)
**Analyst:** Claude (Anthropic AI)

---

## 🎯 Executive Summary

Formbricks is a **modern, production-ready open-source survey platform** (the "Qualtrics alternative") built with cutting-edge web technologies. The codebase demonstrates **excellent architectural practices** with strong type safety, comprehensive error handling, and a well-organized monorepo structure.

**Overall Assessment:** ⭐⭐⭐⭐⭐ (4.5/5)

**Key Strengths:**
- Modern tech stack (React 19, Next.js 15, Prisma 6, TypeScript 5.8)
- Excellent type safety with Zod runtime validation throughout
- Clean modular architecture with clear separation of concerns
- Strong security practices (2FA, encryption, rate limiting)
- Comprehensive testing infrastructure (Vitest + Playwright)
- Production-ready deployment options (Docker, Kubernetes, Vercel)

**Main Improvement Opportunities:**
- Increase test coverage from ~18% to 40-50%
- Bundle size optimization (lodash, framer-motion)
- Implement encryption key rotation mechanism
- Add SSRF protection for webhooks
- Standardize dependency versions (Redis, esbuild)

---

## 📊 At a Glance

| Metric | Value |
|--------|-------|
| **Lines of Code** | ~54,710 TypeScript/JavaScript |
| **Total Files** | 1,934 TS/JS files |
| **Test Coverage** | ~18% (347 test files) |
| **Packages** | 13 workspace packages |
| **Dependencies** | ~200+ unique packages |
| **License** | AGPL-3.0 (core) + Enterprise license |
| **Deployment Options** | Docker, Kubernetes, Vercel, Railway |
| **Database** | PostgreSQL 16+ (with pgvector) |

---

## 🏗️ Architecture Overview

### Pattern: **Modular Monolith with Package-Based Separation**

```
┌─────────────────────────────────────────────┐
│          apps/web (Next.js 15)              │
│  ┌────────────┐  ┌──────────────────────┐  │
│  │ App Router │  │ API Routes (v1, v2)  │  │
│  └────────────┘  └──────────────────────┘  │
└─────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│           Shared Packages                   │
│  • database (Prisma ORM)                    │
│  • types (TypeScript + Zod)                 │
│  • surveys (Preact rendering)               │
│  • cache (Redis abstraction)                │
│  • storage (S3 abstraction)                 │
└─────────────────────────────────────────────┘
                    ▼
┌─────────────────────────────────────────────┐
│         Infrastructure Layer                │
│  PostgreSQL │ Redis │ S3 │ SMTP             │
└─────────────────────────────────────────────┘
```

**Key Design Decisions:**
1. **Server Components First** - Leverages Next.js 15 for server-side data fetching
2. **Service Layer Pattern** - Business logic in `lib/*/service.ts` files
3. **Type-Safe Everything** - Zod schemas generate both runtime validators and TypeScript types
4. **Result Type Pattern** - Rust-like `Result<T, E>` for graceful error handling
5. **Fail-Safe Infrastructure** - Redis/S3 failures don't break core functionality

---

## 🔑 Key Features

**Core Platform:**
- **15 Question Types** - Open text, multiple choice, NPS, rating, file upload, date, matrix, ranking, etc.
- **Advanced Survey Logic** - Variables, calculations, conditional branching, jump logic
- **Multiple Distribution Methods** - Link surveys, in-app widgets, website embeds, email
- **Powerful Targeting** - Segments, action triggers, display rules, recontact periods
- **Integrations** - Slack, Notion, Google Sheets, Airtable, webhooks, Zapier
- **Multi-language** - i18next with 10+ languages, automated translation (Lingo.dev)

**Enterprise Features** (Licensed):
- SSO/SAML authentication
- Team-based access control
- Audit logging
- Multi-language surveys
- Response quotas
- White-labeling
- Advanced contact management

---

## 🛠️ Technology Stack

### Core Framework
- **Next.js 15.5.6** - App Router with React Server Components
- **React 19.1.0** - Latest React with concurrent features
- **TypeScript 5.8.3** - Strict mode enabled
- **Turborepo 2.5.3** - Monorepo build orchestration

### Database & Storage
- **Prisma 6.14.0** - Type-safe ORM
- **PostgreSQL 16+** - With pgvector extension
- **Redis 5.8.1** - Caching and rate limiting
- **AWS SDK v3** - S3-compatible storage

### UI & Styling
- **TailwindCSS 3.4.17** - Utility-first CSS
- **Radix UI** - 17 accessible headless components
- **Framer Motion** - Animations
- **Lucide React** - Icons

### Testing & Quality
- **Vitest 3.1.3** - Unit testing
- **Playwright 1.52.0** - E2E testing
- **ESLint 8.57.0** - Linting (Vercel style guide)
- **Prettier** - Code formatting

### Observability
- **Sentry** - Error tracking
- **PostHog** - Product analytics
- **OpenTelemetry + Prometheus** - Metrics
- **Pino** - Structured logging

---

## 📈 Code Quality Highlights

### ✅ Strengths

**Type Safety (5/5):**
- Strict TypeScript configuration
- Zod schemas for runtime validation
- Prisma for type-safe database queries
- No `any` types in critical paths

**Error Handling (5/5):**
- Custom error classes with HTTP status codes
- Result type for graceful degradation
- Comprehensive error logging
- User-friendly error messages

**Security (4.5/5):**
- bcrypt password hashing with timing attack prevention
- AES-256-GCM encryption
- Rate limiting on all endpoints
- CSRF protection, security headers

**Testing (3.5/5):**
- 347 test files (18% coverage)
- Excellent E2E test suite
- Good service layer testing
- *Opportunity:* Increase coverage to 40-50%

**Documentation (3/5):**
- Good README and contribution guides
- Some JSDoc coverage
- Inline comments where needed
- *Opportunity:* More comprehensive API docs

---

## 🚀 Quick Wins (High Impact, Low Effort)

1. **Standardize Redis Version** (30 min)
   - Upgrade `apps/web` from `redis@4.7.0` to `5.8.1`
   - Impact: Bug fixes and performance improvements

2. **Add SSRF Protection** (2 hours)
   - Block webhook URLs pointing to private IPs
   - Impact: Prevent server-side request forgery attacks

3. **Bundle Size Optimization** (4 hours)
   - Replace lodash imports with native ES6
   - Dynamic import heavy components
   - Impact: ~15-20% reduction in bundle size

4. **Improve Test Coverage** (ongoing)
   - Add tests for critical service layer functions
   - Target: 40% coverage
   - Impact: Increased confidence in changes

---

## 📚 Document Navigation

**Initial Analysis:**
- [Repository Structure](./repository-structure.md) - Detailed monorepo organization
- [Dependency Graph](./dependency-graph.md) - Complete dependency analysis
- [Metrics Summary](./metrics-summary.md) - Quantitative code metrics
- [Terminology Glossary](./terminology-glossary.md) - Project-specific terms

**Blog Series:**
- [00 - Series Outline](../blog-series/00-series-outline.md)
- 01 - Architecture and Core Concepts
- 02 - Deep Dive: Survey Engine
- 03 - Patterns and Practices
- 04 - Extending and Integrating
- 05 - Performance Analysis

**RFCs (Request for Comments):**
- [00 - Prioritization Matrix](../rfcs/00-prioritization-matrix.md)
- RFC-0001 through RFC-0010 for specific improvements

**Diagrams:**
- Architecture overview
- Data flow diagrams
- Component relationships

**Executive Summary:**
- [Executive Summary](../executive-summary.md) - 2-page overview for stakeholders

---

## 🎓 Learning Paths

**New to Formbricks?**
1. Read this Quick Start
2. Review [Repository Structure](./repository-structure.md)
3. Read [Blog 01 - Architecture Overview](../blog-series/01-architecture-overview.md)
4. Explore the codebase starting at `apps/web/app/`

**Want to Contribute?**
1. Review [Code Quality Metrics](./metrics-summary.md)
2. Read [Blog 03 - Patterns and Practices](../blog-series/03-patterns-practices.md)
3. Check [RFC Prioritization](../rfcs/00-prioritization-matrix.md) for ideas
4. Follow the contribution guidelines in the main README

**Planning Improvements?**
1. Review [Blog 05 - Performance Analysis](../blog-series/05-performance-analysis.md)
2. Check [RFCs](../rfcs/) for proposed improvements
3. Read [Dependency Analysis](./dependency-graph.md) for upgrade opportunities

---

## 🔗 External Resources

- **GitHub Repository:** https://github.com/formbricks/formbricks
- **Documentation:** https://formbricks.com/docs
- **Cloud Platform:** https://app.formbricks.com
- **Community:** Discord, GitHub Discussions
- **License:** AGPL-3.0 ([LICENSE](https://github.com/formbricks/formbricks/blob/341e2639e1a82270bf91af3ff35e7f420b9bf6e7/LICENSE))

---

## 📞 Questions?

This analysis is based on commit `341e263` from November 16, 2025. The codebase is actively developed, so some details may change. For the latest information, consult the official documentation and repository.

**Analysis Methodology:**
- Automated code analysis tools
- Manual code review of critical paths
- Architecture pattern identification
- Security assessment
- Performance profiling
- Best practice comparison with industry standards

---

*This document is part of a comprehensive technical analysis of the Formbricks codebase. All assessments are based on the state of the code at commit 341e263.*
