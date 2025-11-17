import dns from "dns/promises";
import { InvalidInputError } from "@formbricks/types/errors";

/**
 * SSRF Protection for Webhook URLs
 * Prevents webhooks from targeting private IPs, localhost, and cloud metadata endpoints
 * See RFC-0003 for full specification
 */

// Private IP ranges (CIDR notation)
const PRIVATE_IP_RANGES = [
  // IPv4 private ranges
  { start: "10.0.0.0", end: "10.255.255.255" },
  { start: "172.16.0.0", end: "172.31.255.255" },
  { start: "192.168.0.0", end: "192.168.255.255" },
  // Loopback
  { start: "127.0.0.0", end: "127.255.255.255" },
  // Link-local
  { start: "169.254.0.0", end: "169.254.255.255" },
  // Carrier-grade NAT
  { start: "100.64.0.0", end: "100.127.255.255" },
];

// Known cloud metadata endpoints
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "169.254.169.254", // AWS/GCP/Azure metadata
  "169.254.169.253", // AWS time sync
  "fd00:ec2::254", // AWS IPv6 metadata
]);

/**
 * Convert IPv4 address to 32-bit integer for range comparison
 */
function ipToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

/**
 * Check if an IPv4 address is in a private range
 */
function isPrivateIpv4(ip: string): boolean {
  const ipInt = ipToInt(ip);

  for (const range of PRIVATE_IP_RANGES) {
    const startInt = ipToInt(range.start);
    const endInt = ipToInt(range.end);

    if (ipInt >= startInt && ipInt <= endInt) {
      return true;
    }
  }

  return false;
}

/**
 * Check if an IPv6 address is private/reserved
 */
function isPrivateIpv6(ip: string): boolean {
  // IPv6 loopback
  if (ip === "::1") return true;

  // IPv6 link-local (fe80::/10)
  if (ip.startsWith("fe80:")) return true;

  // IPv6 unique local (fc00::/7)
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true;

  return false;
}

/**
 * Validate that a URL is safe to use for webhooks
 * @throws InvalidInputError if the URL targets a blocked destination
 */
export async function validateWebhookUrl(url: string): Promise<void> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidInputError("Invalid URL format");
  }

  // Only allow HTTP/HTTPS
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new InvalidInputError("Only HTTP and HTTPS protocols are allowed");
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variations
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname === "::"
  ) {
    throw new InvalidInputError("Localhost URLs are not allowed for security reasons");
  }

  // Block known metadata endpoints
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new InvalidInputError(
      `The hostname "${hostname}" is blocked for security reasons (cloud metadata endpoint)`
    );
  }

  // Resolve hostname to IP addresses
  let ips: string[];
  try {
    // Try IPv4 first
    ips = await dns.resolve4(hostname).catch(async () => {
      // Fall back to IPv6
      return await dns.resolve6(hostname);
    });
  } catch (error) {
    // If DNS resolution fails, check if it's already an IP address
    if (hostname.includes(":")) {
      // Likely IPv6
      if (isPrivateIpv6(hostname)) {
        throw new InvalidInputError("Private IPv6 addresses are not allowed for security reasons");
      }
      return; // Allow if not private
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      // IPv4 address
      if (isPrivateIpv4(hostname)) {
        throw new InvalidInputError("Private IP addresses are not allowed for security reasons");
      }
      return; // Allow if not private
    }

    // DNS resolution failed and it's not an IP
    throw new InvalidInputError(`Unable to resolve hostname: ${hostname}`);
  }

  // Check resolved IPs
  for (const ip of ips) {
    if (ip.includes(":")) {
      // IPv6
      if (isPrivateIpv6(ip)) {
        throw new InvalidInputError(
          `The hostname "${hostname}" resolves to a private IPv6 address: ${ip}`
        );
      }
    } else {
      // IPv4
      if (isPrivateIpv4(ip)) {
        throw new InvalidInputError(`The hostname "${hostname}" resolves to a private IP address: ${ip}`);
      }
    }

    // Check metadata endpoint IPs
    if (BLOCKED_HOSTNAMES.has(ip)) {
      throw new InvalidInputError(
        `The hostname "${hostname}" resolves to a blocked IP address: ${ip} (cloud metadata endpoint)`
      );
    }
  }
}
