/**
 * Network Security Guard
 *
 * Enforces outbound domain whitelisting, TLS/HTTPS encryption,
 * and port restrictions.
 */

import { createLogger } from "@concurrent/core";
import type { NetworkSecurityPolicy } from "../types.js";

export class NetworkSecurityGuard {
  private log = createLogger({ component: "network-security" });
  readonly policy: NetworkSecurityPolicy;

  constructor(optionsOrPolicy?: Partial<NetworkSecurityPolicy> | { policy?: Partial<NetworkSecurityPolicy> }) {
    const rawPolicy =
      optionsOrPolicy && "policy" in optionsOrPolicy
        ? optionsOrPolicy.policy
        : (optionsOrPolicy as Partial<NetworkSecurityPolicy>);

    this.policy = {
      allowedDomains: rawPolicy?.allowedDomains || ["*"],
      enforceTls: rawPolicy?.enforceTls ?? true,
      blockedPorts: rawPolicy?.blockedPorts || [21, 23, 25, 3389],
    };
  }

  /** Alias for validateUrl */
  isUrlAllowed(rawUrl: string): { allowed: boolean; reason?: string } {
    return this.validateUrl(rawUrl);
  }

  /**
   * Validate an outbound URL against network security policy.
   */
  validateUrl(rawUrl: string): { allowed: boolean; reason?: string } {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return { allowed: false, reason: `Malformed URL: "${rawUrl}"` };
    }

    const isLocalhost =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname.startsWith("192.168.");

    // 1. Enforce TLS/HTTPS (allow unencrypted only for localhost)
    if (this.policy.enforceTls && !isLocalhost) {
      if (parsed.protocol !== "https:" && parsed.protocol !== "wss:") {
        this.log.warn({ url: rawUrl, protocol: parsed.protocol }, "Blocked non-TLS connection");
        return {
          allowed: false,
          reason: `Security violation: Insecure protocol "${parsed.protocol}" blocked. TLS is required for external connections.`,
        };
      }
    }

    // 2. Enforce Blocked Ports
    if (parsed.port && this.policy.blockedPorts) {
      const portNum = Number(parsed.port);
      if (this.policy.blockedPorts.includes(portNum)) {
        return {
          allowed: false,
          reason: `Security violation: Connection to restricted port ${portNum} is blocked.`,
        };
      }
    }

    // 3. Domain Whitelist
    if (this.policy.allowedDomains.includes("*") || isLocalhost) {
      return { allowed: true };
    }

    const host = parsed.hostname.toLowerCase();
    const isAllowed = this.policy.allowedDomains.some((domain) => {
      const d = domain.toLowerCase();
      if (d.startsWith("*.")) {
        const root = d.slice(2);
        return host === root || host.endsWith("." + root);
      }
      return host === d;
    });

    if (!isAllowed) {
      this.log.warn({ host, allowedDomains: this.policy.allowedDomains }, "Domain not in allowed whitelist");
      return {
        allowed: false,
        reason: `Domain "${host}" is not in the allowed network outbound domains whitelist.`,
      };
    }

    return { allowed: true };
  }
}
