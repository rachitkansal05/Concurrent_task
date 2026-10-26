/**
 * Data Classification Engine
 *
 * Scans content and assigns data governance tiers:
 *   - public: Safe for public dissemination
 *   - internal: Standard company-internal info
 *   - confidential: Sensitive business/financial/customer data
 *   - restricted: High-risk secrets (passwords, tokens, private keys, SSNs)
 *
 * Enforces data egress policies (blocks sending confidential/restricted data to external LLMs).
 */

import type {
  DataClassificationLevel,
  DataClassificationResult,
} from "../types.js";

export class DataClassifier {
  private restrictedPatterns = [
    { category: "private_key", regex: /-----BEGIN [A-Z\s]*PRIVATE KEY-----/i },
    { category: "api_key", regex: /\b(sk-[a-zA-Z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9_]{36,})\b/ },
    { category: "token", regex: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/i },
    { category: "ssn", regex: /\b\d{3}-\d{2}-\d{4}\b/ },
    { category: "credit_card", regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/ },
  ];

  private confidentialPatterns = [
    { category: "salary_compensation", regex: /\b(salary|compensation|equity grant|bonus)\s*[:=]\s*\$?\d+/i },
    { category: "financial_report", regex: /\b(revenue|ebitda|gross margin|profit margin|q[1-4] financial)\b/i },
    { category: "m&a_confidential", regex: /\b(acquisition|merger|nda|strictly confidential|privileged)\b/i },
  ];

  private internalPatterns = [
    { category: "internal_domain", regex: /\.internal(?:\.com)?\b/i },
    { category: "intranet", regex: /\b(confluence|jira|ldap|active directory|ldap:)\b/i },
  ];

  /** Classify arbitrary text content */
  classify(text: string): DataClassificationResult {
    return this.classifyContent(text);
  }

  /** Classify arbitrary text content */
  classifyContent(text: string): DataClassificationResult {
    if (!text || typeof text !== "string") {
      return {
        level: "public",
        categories: [],
        containsRestricted: false,
        containsPii: false,
      };
    }

    const categories: string[] = [];

    // 1. Check Restricted
    for (const pat of this.restrictedPatterns) {
      if (pat.regex.test(text)) {
        categories.push(pat.category);
      }
    }
    if (categories.length > 0) {
      return {
        level: "restricted",
        categories,
        containsRestricted: true,
        containsPii: categories.includes("ssn") || categories.includes("credit_card"),
      };
    }

    // 2. Check Confidential
    for (const pat of this.confidentialPatterns) {
      if (pat.regex.test(text)) {
        categories.push(pat.category);
      }
    }
    if (categories.length > 0) {
      return {
        level: "confidential",
        categories,
        containsRestricted: false,
        containsPii: false,
      };
    }

    // 3. Check Internal
    for (const pat of this.internalPatterns) {
      if (pat.regex.test(text)) {
        categories.push(pat.category);
      }
    }
    if (categories.length > 0) {
      return {
        level: "internal",
        categories,
        containsRestricted: false,
        containsPii: false,
      };
    }

    // 4. Default Public
    return {
      level: "public",
      categories: [],
      containsRestricted: false,
      containsPii: false,
    };
  }

  /**
   * Determine if data can be safely transmitted to an external LLM provider.
   */
  canTransmitToExternalLLM(payload: unknown): { allowed: boolean; reason?: string; level: DataClassificationLevel } {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload);
    const classification = this.classify(text);

    if (classification.level === "restricted") {
      return {
        allowed: false,
        level: "restricted",
        reason: `Transmission blocked: Data classified as RESTRICTED (found: ${classification.categories.join(", ")})`,
      };
    }

    if (classification.level === "confidential") {
      return {
        allowed: false,
        level: "confidential",
        reason: `Transmission blocked: Data classified as CONFIDENTIAL (found: ${classification.categories.join(", ")})`,
      };
    }

    return {
      allowed: true,
      level: classification.level,
    };
  }
}
