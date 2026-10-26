/**
 * Log Redactor
 *
 * Scans and redacts passwords, bearer tokens, JWTs, API keys, private keys,
 * and PII (SSNs, credit cards) from text and structured payloads.
 */

export class LogRedactor {
  private knownSecrets: Set<string> = new Set();

  private patterns: Array<{ regex: RegExp; replacement: string }> = [
    // Private Keys
    {
      regex: /-----BEGIN [A-Z\s]*PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]*PRIVATE KEY-----/g,
      replacement: "[REDACTED_PRIVATE_KEY]",
    },
    // Bearer / Authorization tokens
    {
      regex: /Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi,
      replacement: "Bearer [REDACTED_TOKEN]",
    },
    // JWT tokens
    {
      regex: /eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+/g,
      replacement: "[REDACTED_JWT]",
    },
    // API keys (OpenAI sk-..., GitHub ghp_... / gho_...)
    {
      regex: /\b(sk-[a-zA-Z0-9_\-]{20,})\b/g,
      replacement: "[REDACTED_API_KEY]",
    },
    {
      regex: /\b(gh[pousr]_[A-Za-z0-9_]{36,})\b/g,
      replacement: "[REDACTED_GITHUB_KEY]",
    },
    // Passwords in URL strings e.g. https://user:pass@host
    {
      regex: /:\/\/([^:]+):(?!\[REDACTED)([^@]+)@/g,
      replacement: "://$1:[REDACTED_PASSWORD]@",
    },
    // Social Security Numbers (SSN)
    {
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: "[REDACTED_SSN]",
    },
    // Credit Cards (13-16 digits with dashes or spaces)
    {
      regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
      replacement: "[REDACTED_CREDIT_CARD]",
    },
  ];

  /** Register an exact secret string that must always be masked */
  registerSecret(secret: string): void {
    if (secret && secret.length >= 4) {
      this.knownSecrets.add(secret);
    }
  }

  /** Redact sensitive data from a string */
  redactText(text: string): string {
    if (!text || typeof text !== "string") return text;

    let result = text;

    // 1. Redact known registered secrets
    for (const secret of this.knownSecrets) {
      if (result.includes(secret)) {
        result = result.split(secret).join("[REDACTED_SECRET]");
      }
    }

    // 2. Apply regex redaction patterns
    for (const { regex, replacement } of this.patterns) {
      result = result.replace(regex, replacement);
    }

    return result;
  }

  /** Redact structured objects recursively */
  redactObject<T>(obj: T): T {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === "string") {
      return this.redactText(obj) as unknown as T;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.redactObject(item)) as unknown as T;
    }

    if (typeof obj === "object") {
      const copy: Record<string, unknown> = {};
      const sensitiveKeyPattern = /^(password|secret|token|api_?key|auth|credential|cvv|ssn)$/i;

      for (const [key, val] of Object.entries(obj)) {
        if (sensitiveKeyPattern.test(key) && typeof val === "string") {
          copy[key] = "[REDACTED_CREDENTIAL]";
        } else {
          copy[key] = this.redactObject(val);
        }
      }
      return copy as T;
    }

    return obj;
  }
}
