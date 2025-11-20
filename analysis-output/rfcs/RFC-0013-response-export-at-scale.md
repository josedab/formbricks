# RFC-0013: Response Data Export at Scale

**Status:** Draft
**Author:** Analysis Team
**Created:** 2025-11-17
**Priority:** Medium (Strategic)
**Effort:** 2 weeks
**Impact:** High (Enterprise scalability)

## Summary

Implement streaming export for large survey response datasets to handle millions of responses without memory issues or timeouts. Current export loads all data into memory.

## Motivation

**Current Problem:**
```typescript
// Current export (simplified)
export async function exportResponses(surveyId: string) {
  // ❌ Loads ALL responses into memory
  const responses = await prisma.response.findMany({
    where: { surveyId },
    include: { answers: true, contact: true },
  });

  // ❌ Formats entire dataset in memory
  const csv = formatAsCSV(responses);

  // ❌ Returns entire file at once
  return new Response(csv, {
    headers: { "Content-Type": "text/csv" },
  });
}
```

**Issues at Scale:**
- ❌ 10K responses = ~50MB memory = works
- ❌ 100K responses = ~500MB memory = slow
- ❌ 1M responses = ~5GB memory = **crashes**
- ❌ Serverless timeout (30s) exceeded
- ❌ No progress indication for long exports

**Enterprise Customer Impact:**
- Cannot export large surveys
- Support escalations for "export not working"
- Forced to use API pagination manually

## Detailed Design

### Streaming CSV Export

```typescript
// apps/web/app/api/v2/management/surveys/[surveyId]/export/route.ts

import { Transform } from "stream";
import { pipeline } from "stream/promises";

export async function GET(
  req: Request,
  { params }: { params: { surveyId: string } }
) {
  const { surveyId } = params;

  // Validate access
  await checkAccess(surveyId);

  // Create streaming response
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Start background export
  exportResponsesStreaming(surveyId, writer);

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="survey-${surveyId}-responses.csv"`,
      "Transfer-Encoding": "chunked",
    },
  });
}

async function exportResponsesStreaming(
  surveyId: string,
  writer: WritableStreamDefaultWriter
) {
  const encoder = new TextEncoder();

  try {
    // Write CSV header
    const header = "Response ID,Contact ID,Created At,Finished,...\n";
    await writer.write(encoder.encode(header));

    // Stream responses in batches
    let cursor: string | undefined;
    const batchSize = 1000;

    while (true) {
      const responses = await prisma.response.findMany({
        where: { surveyId },
        include: { answers: true },
        take: batchSize + 1,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
        orderBy: { createdAt: "asc" },
      });

      if (responses.length === 0) break;

      const hasMore = responses.length > batchSize;
      const batch = hasMore ? responses.slice(0, -1) : responses;

      // Convert batch to CSV rows
      for (const response of batch) {
        const row = formatResponseAsCSVRow(response);
        await writer.write(encoder.encode(row + "\n"));
      }

      if (!hasMore) break;
      cursor = batch[batch.length - 1].id;
    }

    await writer.close();
  } catch (error) {
    logger.error({ error, surveyId }, "Export failed");
    await writer.abort(error);
  }
}
```

### Background Export Jobs

**For Very Large Exports (>1M rows):**

```prisma
model ExportJob {
  id              String         @id @default(cuid())
  userId          String
  user            User           @relation(fields: [userId], references: [id])

  surveyId        String
  survey          Survey         @relation(fields: [surveyId], references: [id])

  format          ExportFormat   @default(csv)
  filters         Json?          // Optional filters

  status          ExportStatus   @default(pending)
  progress        Int            @default(0)  // Percentage
  totalRows       Int?
  processedRows   Int            @default(0)

  fileUrl         String?        // S3 URL when complete
  fileSize        BigInt?
  expiresAt       DateTime?      // Auto-delete after 7 days

  errorMessage    String?

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  completedAt     DateTime?

  @@index([userId, status])
  @@index([surveyId, status])
}

enum ExportFormat {
  csv
  json
  xlsx
  parquet
}

enum ExportStatus {
  pending
  processing
  completed
  failed
  expired
}
```

**Worker Implementation:**
```typescript
// apps/web/app/api/cron/process-exports/route.ts

export async function GET(req: Request) {
  // Auth check
  if (req.headers.get("x-api-key") !== CRON_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get pending export jobs
  const jobs = await prisma.exportJob.findMany({
    where: { status: "pending" },
    take: 5,  // Process 5 at a time
  });

  for (const job of jobs) {
    await processExportJob(job);
  }

  return Response.json({ processed: jobs.length });
}

async function processExportJob(job: ExportJob) {
  try {
    // Mark as processing
    await prisma.exportJob.update({
      where: { id: job.id },
      data: { status: "processing" },
    });

    // Get total count for progress tracking
    const totalRows = await prisma.response.count({
      where: { surveyId: job.surveyId },
    });

    await prisma.exportJob.update({
      where: { id: job.id },
      data: { totalRows },
    });

    // Create temp file for streaming
    const tmpFile = `/tmp/export-${job.id}.csv`;
    const writeStream = fs.createWriteStream(tmpFile);

    // Stream responses to file
    let cursor: string | undefined;
    let processedRows = 0;

    while (true) {
      const responses = await prisma.response.findMany({
        where: { surveyId: job.surveyId },
        include: { answers: true },
        take: 1000,
        ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      });

      if (responses.length === 0) break;

      for (const response of responses) {
        writeStream.write(formatResponseAsCSVRow(response) + "\n");
        processedRows++;
      }

      // Update progress
      const progress = Math.floor((processedRows / totalRows) * 100);
      await prisma.exportJob.update({
        where: { id: job.id },
        data: { progress, processedRows },
      });

      cursor = responses[responses.length - 1].id;
    }

    writeStream.end();

    // Upload to S3
    const fileUrl = await uploadToS3(tmpFile, `exports/${job.id}.csv`);
    const fileSize = fs.statSync(tmpFile).size;

    // Mark as completed
    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        fileUrl,
        fileSize,
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        progress: 100,
      },
    });

    // Send email notification
    await sendExportReadyEmail(job.user.email, fileUrl);

    // Clean up temp file
    fs.unlinkSync(tmpFile);
  } catch (error) {
    logger.error({ error, jobId: job.id }, "Export job failed");

    await prisma.exportJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error.message,
      },
    });
  }
}
```

### Format-Specific Optimizations

**Excel (XLSX) Streaming:**
```typescript
import ExcelJS from "exceljs";

async function exportToExcel(surveyId: string, outputPath: string) {
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    filename: outputPath,
  });

  const worksheet = workbook.addWorksheet("Responses");

  // Add header row
  worksheet.columns = [
    { header: "Response ID", key: "id", width: 20 },
    { header: "Contact ID", key: "contactId", width: 20 },
    { header: "Created At", key: "createdAt", width: 20 },
    // ... dynamic columns for questions
  ];

  // Stream data rows
  let cursor: string | undefined;
  while (true) {
    const responses = await prisma.response.findMany({
      where: { surveyId },
      take: 1000,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    if (responses.length === 0) break;

    for (const response of responses) {
      worksheet.addRow(formatResponseForExcel(response)).commit();
    }

    cursor = responses[responses.length - 1].id;
  }

  await worksheet.commit();
  await workbook.commit();
}
```

**JSON Lines (JSONL):**
```typescript
async function exportToJSONL(surveyId: string, writer: WritableStreamDefaultWriter) {
  let cursor: string | undefined;

  while (true) {
    const responses = await prisma.response.findMany({
      where: { surveyId },
      include: { answers: true },
      take: 1000,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    if (responses.length === 0) break;

    for (const response of responses) {
      const json = JSON.stringify(response);
      await writer.write(new TextEncoder().encode(json + "\n"));
    }

    cursor = responses[responses.length - 1].id;
  }
}
```

**Parquet (for analytics):**
```typescript
import parquet from "parquetjs";

async function exportToParquet(surveyId: string, outputPath: string) {
  const schema = new parquet.ParquetSchema({
    id: { type: "UTF8" },
    contactId: { type: "UTF8", optional: true },
    createdAt: { type: "TIMESTAMP_MILLIS" },
    finished: { type: "BOOLEAN" },
    // ... dynamic schema
  });

  const writer = await parquet.ParquetWriter.openFile(schema, outputPath);

  let cursor: string | undefined;
  while (true) {
    const responses = await prisma.response.findMany({
      where: { surveyId },
      take: 1000,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });

    if (responses.length === 0) break;

    for (const response of responses) {
      await writer.appendRow(formatResponseForParquet(response));
    }

    cursor = responses[responses.length - 1].id;
  }

  await writer.close();
}
```

## Implementation Plan

### Week 1: Streaming Export (Days 1-5)

**Day 1-2: CSV Streaming**
- [ ] Implement streaming CSV export endpoint
- [ ] Add cursor-based pagination
- [ ] Test with large datasets (1M+ rows)

**Day 3: Excel Streaming**
- [ ] Implement XLSX streaming with ExcelJS
- [ ] Handle dynamic columns (survey questions)

**Day 4: JSON/JSONL**
- [ ] Implement JSON Lines export
- [ ] Add full JSON export option

**Day 5: Testing**
- [ ] Load test with 10M rows
- [ ] Memory profiling
- [ ] Fix any issues

### Week 2: Background Jobs & UI (Days 6-10)

**Day 6-7: Background Jobs**
- [ ] Implement ExportJob model
- [ ] Create worker for processing jobs
- [ ] S3 integration for file storage

**Day 8: Progress Tracking**
- [ ] WebSocket or polling for progress updates
- [ ] Email notifications

**Day 9: UI**
- [ ] Export modal with format selection
- [ ] Job status page
- [ ] Download link with expiration

**Day 10: Documentation**
- [ ] API documentation
- [ ] User guide
- [ ] Admin documentation

## Performance Benchmarks

**Memory Usage:**
- Before: 5GB for 1M rows
- After: <100MB constant (streaming)

**Export Speed:**
- 10K rows: <5 seconds
- 100K rows: <30 seconds
- 1M rows: <5 minutes
- 10M rows: <30 minutes (background job)

**Throughput:**
- CSV: ~3,000 rows/second
- XLSX: ~1,500 rows/second
- Parquet: ~5,000 rows/second

## User Experience

**Instant Export (<10K rows):**
```
User clicks "Export" → Streaming download starts immediately
```

**Background Export (>10K rows):**
```
User clicks "Export" → Modal: "Your export is being prepared"
  ↓
Email sent when ready → Download link (expires in 7 days)
```

**Progress Tracking:**
```
Export Status: Processing (45%)
Estimated time remaining: 2 minutes
You'll receive an email when complete.
```
