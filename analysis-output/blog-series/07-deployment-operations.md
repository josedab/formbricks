# Deployment and Operations

**Part 7 of 7 - Formbricks Technical Deep Dive**
**Commit:** [`341e263`](https://github.com/formbricks/formbricks/commit/341e2639e1a82270bf91af3ff35e7f420b9bf6e7)

## Deployment Options

### 1. Docker

**Multi-stage build:**
```dockerfile
# Stage 1: Builder
FROM node:22-alpine AS installer
WORKDIR /app
COPY . .
RUN corepack enable pnpm
RUN pnpm install
RUN pnpm build

# Stage 2: Runner
FROM node:22-alpine AS runner
USER nextjs:nextjs
COPY --from=installer --chown=nextjs:nextjs /app/.next/standalone ./
EXPOSE 3000
CMD ["node", "server.js"]
```

**Production Compose:**
```yaml
services:
  formbricks:
    image: ghcr.io/formbricks/formbricks:latest
    environment:
      - DATABASE_URL=postgresql://...
      - REDIS_URL=redis://valkey:6379
      - ENCRYPTION_KEY=...
    depends_on:
      - postgres
      - valkey
  
  postgres:
    image: pgvector/pgvector:pg17
    volumes:
      - postgres_data:/var/lib/postgresql/data
  
  valkey:
    image: valkey/valkey
    volumes:
      - valkey_data:/data
```

### 2. Kubernetes

**Helm Chart:**
```yaml
# helm-chart/values.yaml
replicaCount: 3

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 60

resources:
  requests:
    memory: "1Gi"
    cpu: "1"
  limits:
    memory: "2Gi"

postgresql:
  enabled: true
  auth:
    database: formbricks
    username: formbricks

redis:
  enabled: true
  architecture: standalone
```

**Deploy:**
```bash
helm install formbricks ./helm-chart \
  --set env.NEXTAUTH_SECRET=$(openssl rand -hex 32) \
  --set env.ENCRYPTION_KEY=$(openssl rand -hex 32)
```

### 3. Vercel

**Configuration:**
```json
// vercel.json
{
  "functions": {
    "app/**/*.ts": {
      "maxDuration": 10,
      "memory": 512
    },
    "app/api/cron/**/*.ts": {
      "maxDuration": 180
    },
    "app/api/v1/client/**/*.ts": {
      "maxDuration": 10,
      "memory": 200
    }
  }
}
```

**Requirements:**
- S3 storage (no local filesystem)
- Redis/Upstash for caching
- PostgreSQL (Neon, Supabase, etc.)

## Infrastructure Requirements

### PostgreSQL

**Minimum:** PostgreSQL 16+ with pgvector
**Recommended:**
- Connection pooling (PgBouncer)
- Read replicas for analytics
- Automated backups (daily)

### Redis/Valkey

**Purpose:** Caching, rate limiting, audit logs
**Configuration:**
```redis
maxmemory 2gb
maxmemory-policy allkeys-lru
appendonly yes
```

### S3-Compatible Storage

**Providers:**
- AWS S3
- MinIO (self-hosted)
- Cloudflare R2
- DigitalOcean Spaces

## Observability

### Logging (Pino)

```typescript
import { logger } from "@formbricks/logger";

logger.info("Survey created");
logger.error({ error, surveyId }, "Survey creation failed");
logger.withContext({ userId }).info("User action");
```

**Output:** Structured JSON logs

### Metrics (Prometheus)

**Enabled:** `PROMETHEUS_ENABLED=1`
**Endpoint:** `/metrics` (port 9464)

**Metrics Collected:**
- HTTP request duration
- Database query latency
- Node.js runtime metrics
- Host metrics (CPU, memory)

### Error Tracking (Sentry)

```typescript
// Automatic error capture
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1
});
```

### Health Checks

**Endpoints:**
- `/health` - Simple status check
- `/api/v2/health` - Detailed (database, cache)

**Kubernetes Probes:**
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10

readinessProbe:
  httpGet:
    path: /health
    port: 3000
  initialDelaySeconds: 10
```

## CI/CD Pipeline

**GitHub Actions:**

1. **PR Validation:**
   - Lint
   - Type check
   - Unit tests
   - E2E tests
   - Build verification

2. **Release Process:**
   - Build Docker image (multi-platform)
   - Push to GHCR
   - Publish Helm chart
   - Tag as `latest` (if stable)

3. **Security Scanning:**
   - Dependency audit
   - Docker image scanning
   - SonarQube analysis

## Production Best Practices

### Environment Variables

**Required:**
```bash
DATABASE_URL=postgresql://...
ENCRYPTION_KEY=$(openssl rand -hex 32)
NEXTAUTH_SECRET=$(openssl rand -hex 32)
WEBAPP_URL=https://your-domain.com
REDIS_URL=redis://...
```

**Recommended:**
```bash
SENTRY_DSN=...
PROMETHEUS_ENABLED=1
S3_BUCKET_NAME=...
SMTP_HOST=...
```

### Security Hardening

1. **Use secrets management** (AWS Secrets Manager, Vault)
2. **Enable HTTPS** (enforce via HSTS header)
3. **Configure rate limiting**
4. **Enable audit logging** (Enterprise)
5. **Regular backups** (database + Redis)

### Performance Tuning

1. **Connection pooling** (25-50 per instance)
2. **Redis maxmemory** (2GB+ recommended)
3. **Next.js caching** (leverages Redis)
4. **CDN for static assets**

### Monitoring Alerts

**Critical:**
- Database connection failures
- Redis unavailability
- Container restarts
- SSL certificate expiration

**Warning:**
- High error rates (>1%)
- Slow response times (>3s p99)
- High memory usage (>80%)

## Scaling Strategy

**Horizontal:**
- Add more app server instances (stateless)
- Use load balancer (ALB, nginx)

**Vertical:**
- Increase database resources
- Larger Redis instance

**Database Scaling:**
- Read replicas for analytics
- Connection pooling (PgBouncer)
- Eventually: Sharding (if massive scale)

## Key Takeaways

1. **Multiple deployment options** - Docker, Kubernetes, Vercel
2. **Comprehensive observability** - Logs, metrics, errors, health checks
3. **Production-ready** - Security hardening, backups, monitoring
4. **Scalable architecture** - Horizontal scaling supported
5. **Well-documented** - Clear deployment guides

**Recommended Stack:**
- **Self-hosted:** Docker Compose (small) or Kubernetes (large)
- **Cloud:** Vercel (app) + Neon (DB) + Upstash (Redis)
- **Enterprise:** Kubernetes + PgBouncer + Redis Cluster

---

## Series Conclusion

We've explored Formbricks from every angle:
1. Architecture and core concepts
2. Survey engine deep dive
3. Patterns and practices
4. Extending and integrating
5. Performance analysis
6. Security review
7. Deployment and operations

**Overall Assessment:** ⭐⭐⭐⭐⭐ (4.5/5)

Formbricks is a **well-engineered, production-ready platform** with excellent architectural decisions. Main improvements: test coverage, bundle optimization, and a few security enhancements (all documented in RFCs).

**Ready for production?** Yes, with recommended security fixes (RFC-0003).

---

*This blog series is based on commit `341e263`. For latest updates, see the [GitHub repository](https://github.com/formbricks/formbricks).*
