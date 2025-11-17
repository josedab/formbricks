import { describe, expect, it, vi } from "vitest";
import {
  generateWebhookSecret,
  getWebhookHeaders,
  signWebhookPayload,
  verifyWebhookSignature,
} from "./signature";

describe("generateWebhookSecret", () => {
  it("should generate a 32-byte base64url encoded secret", () => {
    const secret = generateWebhookSecret();

    // Base64url encoded 32 bytes should be 43 characters (32 * 4/3 without padding)
    expect(secret).toHaveLength(43);
    expect(secret).toMatch(/^[A-Za-z0-9_-]+$/); // base64url character set
  });

  it("should generate unique secrets", () => {
    const secret1 = generateWebhookSecret();
    const secret2 = generateWebhookSecret();
    const secret3 = generateWebhookSecret();

    expect(secret1).not.toBe(secret2);
    expect(secret2).not.toBe(secret3);
    expect(secret1).not.toBe(secret3);
  });
});

describe("signWebhookPayload", () => {
  const mockTimestamp = 1234567890;

  it("should generate a signature with timestamp", () => {
    const payload = { event: "test", data: { id: "123" } };
    const secret = "test-secret";

    const signature = signWebhookPayload(payload, secret, mockTimestamp);

    expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(signature).toContain(`t=${mockTimestamp}`);
  });

  it("should generate different signatures for different payloads", () => {
    const payload1 = { event: "test1" };
    const payload2 = { event: "test2" };
    const secret = "test-secret";

    const sig1 = signWebhookPayload(payload1, secret, mockTimestamp);
    const sig2 = signWebhookPayload(payload2, secret, mockTimestamp);

    expect(sig1).not.toBe(sig2);
  });

  it("should generate different signatures for different secrets", () => {
    const payload = { event: "test" };
    const secret1 = "secret1";
    const secret2 = "secret2";

    const sig1 = signWebhookPayload(payload, secret1, mockTimestamp);
    const sig2 = signWebhookPayload(payload, secret2, mockTimestamp);

    expect(sig1).not.toBe(sig2);
  });

  it("should use current timestamp if not provided", () => {
    const payload = { event: "test" };
    const secret = "test-secret";

    const now = Math.floor(Date.now() / 1000);
    const signature = signWebhookPayload(payload, secret);

    const timestampMatch = signature.match(/t=(\d+)/);
    expect(timestampMatch).not.toBeNull();

    const signatureTimestamp = parseInt(timestampMatch![1], 10);
    expect(Math.abs(signatureTimestamp - now)).toBeLessThan(2); // Within 2 seconds
  });
});

describe("verifyWebhookSignature", () => {
  const mockTimestamp = Math.floor(Date.now() / 1000); // Current time for valid signatures

  it("should verify a valid signature", () => {
    const payload = { event: "test", data: { id: "123" } };
    const secret = "test-secret";

    const signature = signWebhookPayload(payload, secret, mockTimestamp);
    const result = verifyWebhookSignature(payload, signature, secret);

    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("should reject signature with wrong secret", () => {
    const payload = { event: "test" };
    const secret = "test-secret";
    const wrongSecret = "wrong-secret";

    const signature = signWebhookPayload(payload, secret, mockTimestamp);
    const result = verifyWebhookSignature(payload, signature, wrongSecret);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature");
  });

  it("should reject signature with wrong payload", () => {
    const payload1 = { event: "test1" };
    const payload2 = { event: "test2" };
    const secret = "test-secret";

    const signature = signWebhookPayload(payload1, secret, mockTimestamp);
    const result = verifyWebhookSignature(payload2, signature, secret);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature");
  });

  it("should reject expired signatures", () => {
    const payload = { event: "test" };
    const secret = "test-secret";
    const oldTimestamp = mockTimestamp - 600; // 10 minutes ago

    const signature = signWebhookPayload(payload, secret, oldTimestamp);
    const result = verifyWebhookSignature(payload, signature, secret, 300); // 5 minute tolerance

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Signature timestamp outside tolerance window");
  });

  it("should reject future timestamps", () => {
    const payload = { event: "test" };
    const secret = "test-secret";
    const futureTimestamp = mockTimestamp + 600; // 10 minutes in the future

    const signature = signWebhookPayload(payload, secret, futureTimestamp);
    const result = verifyWebhookSignature(payload, signature, secret, 300); // 5 minute tolerance

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Signature timestamp outside tolerance window");
  });

  it("should accept signatures within tolerance window", () => {
    const payload = { event: "test" };
    const secret = "test-secret";
    const recentTimestamp = mockTimestamp - 200; // 200 seconds ago

    const signature = signWebhookPayload(payload, secret, recentTimestamp);
    const result = verifyWebhookSignature(payload, signature, secret, 300); // 5 minute tolerance

    expect(result.valid).toBe(true);
  });

  it("should reject malformed signature header", () => {
    const payload = { event: "test" };
    const secret = "test-secret";

    const result = verifyWebhookSignature(payload, "invalid-signature", secret);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature format");
  });

  it("should reject signature with missing timestamp", () => {
    const payload = { event: "test" };
    const secret = "test-secret";

    const result = verifyWebhookSignature(payload, "v1=abc123", secret);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature format");
  });

  it("should reject signature with missing v1", () => {
    const payload = { event: "test" };
    const secret = "test-secret";

    const result = verifyWebhookSignature(payload, `t=${mockTimestamp}`, secret);

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid signature format");
  });
});

describe("getWebhookHeaders", () => {
  it("should return content-type header without signature when secret is null", () => {
    const payload = { event: "test" };
    const headers = getWebhookHeaders(payload, null);

    expect(headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(headers["X-Formbricks-Signature"]).toBeUndefined();
  });

  it("should return content-type header without signature when secret is undefined", () => {
    const payload = { event: "test" };
    const headers = getWebhookHeaders(payload, undefined);

    expect(headers).toEqual({
      "Content-Type": "application/json",
    });
    expect(headers["X-Formbricks-Signature"]).toBeUndefined();
  });

  it("should include signature header when secret is provided", () => {
    const payload = { event: "test" };
    const secret = "test-secret";
    const headers = getWebhookHeaders(payload, secret);

    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Formbricks-Signature"]).toBeDefined();
    expect(headers["X-Formbricks-Signature"]).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
  });

  it("should generate valid signatures that can be verified", () => {
    const payload = { event: "test", data: { id: "123" } };
    const secret = "test-secret";

    const headers = getWebhookHeaders(payload, secret);
    const signature = headers["X-Formbricks-Signature"];

    const result = verifyWebhookSignature(payload, signature, secret);
    expect(result.valid).toBe(true);
  });
});
