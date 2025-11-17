import { describe, expect, it } from "vitest";
import { InvalidInputError } from "@formbricks/types/errors";
import { validateWebhookUrl } from "./ssrf-protection";

describe("validateWebhookUrl", () => {
  describe("should reject localhost URLs", () => {
    it("should reject http://localhost", async () => {
      await expect(validateWebhookUrl("http://localhost:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://localhost:3000/webhook")).rejects.toThrow(
        "Localhost URLs are not allowed"
      );
    });

    it("should reject http://127.0.0.1", async () => {
      await expect(validateWebhookUrl("http://127.0.0.1:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://127.0.0.1:3000/webhook")).rejects.toThrow(
        "Localhost URLs are not allowed"
      );
    });

    it("should reject http://0.0.0.0", async () => {
      await expect(validateWebhookUrl("http://0.0.0.0:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://0.0.0.0:3000/webhook")).rejects.toThrow(
        "Localhost URLs are not allowed"
      );
    });

    it("should reject IPv6 localhost ::1", async () => {
      await expect(validateWebhookUrl("http://[::1]:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://[::1]:3000/webhook")).rejects.toThrow(
        "Localhost URLs are not allowed"
      );
    });

    it("should reject IPv6 localhost ::", async () => {
      await expect(validateWebhookUrl("http://[::]:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://[::]:3000/webhook")).rejects.toThrow(
        "Localhost URLs are not allowed"
      );
    });
  });

  describe("should reject private IP ranges", () => {
    it("should reject 10.0.0.0/8", async () => {
      await expect(validateWebhookUrl("http://10.0.0.1/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://10.0.0.1/webhook")).rejects.toThrow("Private IP addresses");
    });

    it("should reject 172.16.0.0/12", async () => {
      await expect(validateWebhookUrl("http://172.16.0.1/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://172.16.0.1/webhook")).rejects.toThrow("Private IP addresses");
    });

    it("should reject 192.168.0.0/16", async () => {
      await expect(validateWebhookUrl("http://192.168.1.1/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://192.168.1.1/webhook")).rejects.toThrow("Private IP addresses");
    });

    it("should reject 169.254.0.0/16 (link-local)", async () => {
      await expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
        InvalidInputError
      );
      await expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
        "Private IP addresses"
      );
    });

    it("should reject 100.64.0.0/10 (carrier-grade NAT)", async () => {
      await expect(validateWebhookUrl("http://100.64.0.1/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://100.64.0.1/webhook")).rejects.toThrow("Private IP addresses");
    });
  });

  describe("should reject cloud metadata endpoints", () => {
    it("should reject metadata.google.internal", async () => {
      await expect(validateWebhookUrl("http://metadata.google.internal/computeMetadata/v1/")).rejects.toThrow(
        InvalidInputError
      );
      await expect(validateWebhookUrl("http://metadata.google.internal/computeMetadata/v1/")).rejects.toThrow(
        "cloud metadata endpoint"
      );
    });

    it("should reject 169.254.169.254 (AWS/GCP/Azure metadata)", async () => {
      await expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(
        InvalidInputError
      );
    });
  });

  describe("should reject non-HTTP protocols", () => {
    it("should reject file:// protocol", async () => {
      await expect(validateWebhookUrl("file:///etc/passwd")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("file:///etc/passwd")).rejects.toThrow(
        "Only HTTP and HTTPS protocols are allowed"
      );
    });

    it("should reject ftp:// protocol", async () => {
      await expect(validateWebhookUrl("ftp://example.com/file.txt")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("ftp://example.com/file.txt")).rejects.toThrow(
        "Only HTTP and HTTPS protocols are allowed"
      );
    });

    it("should reject gopher:// protocol", async () => {
      await expect(validateWebhookUrl("gopher://example.com")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("gopher://example.com")).rejects.toThrow(
        "Only HTTP and HTTPS protocols are allowed"
      );
    });
  });

  describe("should reject invalid URLs", () => {
    it("should reject malformed URLs", async () => {
      await expect(validateWebhookUrl("not-a-url")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("not-a-url")).rejects.toThrow("Invalid URL format");
    });

    it("should reject empty string", async () => {
      await expect(validateWebhookUrl("")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("")).rejects.toThrow("Invalid URL format");
    });
  });

  describe("should accept valid public URLs", () => {
    it("should accept https://example.com", async () => {
      // Note: This test will make a real DNS query
      // In a real test environment, you might want to mock the DNS resolution
      await expect(validateWebhookUrl("https://example.com/webhook")).resolves.toBeUndefined();
    });

    it("should accept http://example.com", async () => {
      await expect(validateWebhookUrl("http://example.com/webhook")).resolves.toBeUndefined();
    });

    it("should accept URLs with ports", async () => {
      await expect(validateWebhookUrl("https://example.com:8443/webhook")).resolves.toBeUndefined();
    });

    it("should accept URLs with paths and query strings", async () => {
      await expect(
        validateWebhookUrl("https://example.com/webhook?token=abc123&env=prod")
      ).resolves.toBeUndefined();
    });
  });

  describe("edge cases", () => {
    it("should handle URLs with mixed case hostnames", async () => {
      await expect(validateWebhookUrl("http://LocalHost:3000/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://LOCALHOST:3000/webhook")).rejects.toThrow(InvalidInputError);
    });

    it("should reject 127.0.0.0/8 range (all loopback addresses)", async () => {
      await expect(validateWebhookUrl("http://127.0.0.2/webhook")).rejects.toThrow(InvalidInputError);
      await expect(validateWebhookUrl("http://127.255.255.255/webhook")).rejects.toThrow(InvalidInputError);
    });
  });
});
