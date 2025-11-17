-- AlterTable
-- Add webhook signature fields for RFC-0004
-- secret: HMAC secret for signing webhook payloads (nullable for backwards compatibility)
-- signatureEnabled: Flag to enable/disable signature verification (default true)

ALTER TABLE "Webhook" ADD COLUMN "secret" TEXT;
ALTER TABLE "Webhook" ADD COLUMN "signatureEnabled" BOOLEAN NOT NULL DEFAULT true;

-- Update existing webhooks to generate secrets
-- This will be done via application code, not in migration
-- to ensure proper secret generation using crypto
