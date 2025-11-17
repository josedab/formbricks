import crypto from "crypto";

/**
 * Webhook Signature Utilities (RFC-0004)
 * Implements HMAC-SHA256 signature generation and verification for webhooks
 */

/**
 * Generate a random webhook secret (32 bytes, base64url encoded)
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Sign a webhook payload with HMAC-SHA256
 * @param payload - The webhook payload (will be JSON stringified)
 * @param secret - The webhook secret
 * @param timestamp - Unix timestamp in seconds (for replay protection)
 * @returns The signature string in format: t=<timestamp>,v1=<signature>
 */
export function signWebhookPayload(payload: unknown, secret: string, timestamp?: number): string {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const payloadString = JSON.stringify(payload);

  // Signed payload format: timestamp.payload
  const signedPayload = `${ts}.${payloadString}`;

  // Generate HMAC-SHA256 signature
  const signature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  // Return in Stripe-like format
  return `t=${ts},v1=${signature}`;
}

/**
 * Verify a webhook signature
 * @param payload - The webhook payload (will be JSON stringified)
 * @param signatureHeader - The signature header value
 * @param secret - The webhook secret
 * @param toleranceSeconds - Maximum age of the timestamp (default: 5 minutes)
 * @returns true if signature is valid, false otherwise
 */
export function verifyWebhookSignature(
  payload: unknown,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = 300
): { valid: boolean; error?: string } {
  // Parse signature header
  const parts = signatureHeader.split(",");
  let timestamp: number | null = null;
  let signature: string | null = null;

  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = parseInt(value, 10);
    } else if (key === "v1") {
      signature = value;
    }
  }

  if (!timestamp || !signature) {
    return { valid: false, error: "Invalid signature format" };
  }

  // Check timestamp tolerance (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { valid: false, error: "Signature timestamp outside tolerance window" };
  }

  // Compute expected signature
  const payloadString = JSON.stringify(payload);
  const signedPayload = `${timestamp}.${payloadString}`;
  const expectedSignature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");

  // Constant-time comparison to prevent timing attacks
  if (signature.length !== expectedSignature.length) {
    return { valid: false, error: "Invalid signature" };
  }

  const matches = crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"));

  if (!matches) {
    return { valid: false, error: "Invalid signature" };
  }

  return { valid: true };
}

/**
 * Extract signature headers for webhook requests
 * @param payload - The webhook payload
 * @param secret - The webhook secret (optional - if not provided, no signature header is returned)
 * @returns Headers object with signature header if secret is provided
 */
export function getWebhookHeaders(payload: unknown, secret: string | null | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    headers["X-Formbricks-Signature"] = signWebhookPayload(payload, secret);
  }

  return headers;
}
