/**
 * Secure Credential Vault
 *
 * AES-256-GCM encrypted storage for API keys, passwords, and tokens.
 * Automatically registers plaintext secrets with the LogRedactor so they
 * can never appear in logs or audit outputs.
 */

import crypto from "node:crypto";
import * as fsSync from "node:fs";
import path from "node:path";
import { createLogger } from "@concurrent/core";
import type {
  CredentialType,
  EncryptedVaultPayload,
  StoredCredentialMetadata,
} from "../types.js";
import type { LogRedactor } from "../redaction/redactor.js";

export interface CredentialVaultOptions {
  storagePath?: string;
  masterKey?: string; // 32-byte hex string or passphrase
  redactor?: LogRedactor;
}

interface VaultEntry {
  metadata: StoredCredentialMetadata;
  encrypted: EncryptedVaultPayload;
}

export class CredentialVault {
  private log = createLogger({ component: "credential-vault" });
  private derivedKey: Buffer;
  private entries: Map<string, VaultEntry> = new Map();
  private storagePath?: string;
  private redactor?: LogRedactor;

  constructor(options: CredentialVaultOptions = {}) {
    this.storagePath = options.storagePath;
    this.redactor = options.redactor;

    const masterSecret =
      options.masterKey || process.env.CONCURRENT_VAULT_KEY || "concurrent-default-dev-vault-key-32";

    // Derive 256-bit key via SHA-256
    this.derivedKey = crypto.createHash("sha256").update(masterSecret).digest();

    if (this.storagePath && fsSync.existsSync(this.storagePath)) {
      try {
        const raw = fsSync.readFileSync(this.storagePath, "utf-8");
        const entries: VaultEntry[] = JSON.parse(raw);
        for (const entry of entries) {
          this.entries.set(entry.metadata.id, entry);
        }
      } catch {
        // ignore load error
      }
    }
  }

  /** Store a secret securely */
  set(
    id: string,
    secretValue: string,
    meta: {
      name: string;
      system: string;
      type: CredentialType;
      username?: string;
      expiresAt?: string;
    }
  ): StoredCredentialMetadata {
    if (!secretValue) {
      throw new Error("Secret value cannot be empty.");
    }

    // 1. Encrypt with AES-256-GCM
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", this.derivedKey, iv);
    let cipherText = cipher.update(secretValue, "utf-8", "hex");
    cipherText += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const now = new Date().toISOString();
    const metadata: StoredCredentialMetadata = {
      id,
      name: meta.name,
      system: meta.system,
      type: meta.type,
      username: meta.username,
      expiresAt: meta.expiresAt,
      createdAt: this.entries.get(id)?.metadata.createdAt || now,
      updatedAt: now,
    };

    const entry: VaultEntry = {
      metadata,
      encrypted: {
        iv: iv.toString("hex"),
        authTag,
        cipherText,
      },
    };

    this.entries.set(id, entry);

    // Register secret with redactor so it is masked in all logs
    if (this.redactor) {
      this.redactor.registerSecret(secretValue);
    }

    this.log.info({ credentialId: id, system: meta.system, type: meta.type }, "Secret stored in encrypted vault");
    this.persistSync();
    return metadata;
  }

  /** Set credential using object options */
  setCredential(params: {
    id: string;
    name: string;
    type: CredentialType;
    secret: string;
    system?: string;
    username?: string;
    description?: string;
    environment?: string;
    expiresAt?: string;
  }): StoredCredentialMetadata {
    return this.set(params.id, params.secret, {
      name: params.name,
      system: params.system || "default",
      type: params.type,
      username: params.username,
      expiresAt: params.expiresAt,
    });
  }

  /** Retrieve plaintext secret by credential ID */
  get(id: string): string | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;

    try {
      const iv = Buffer.from(entry.encrypted.iv, "hex");
      const authTag = Buffer.from(entry.encrypted.authTag, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", this.derivedKey, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(entry.encrypted.cipherText, "hex", "utf-8");
      decrypted += decipher.final("utf-8");

      return decrypted;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ credentialId: id, err: msg }, "Failed to decrypt secret from vault");
      throw new Error(`Failed to decrypt secret for credential "${id}": ${msg}`);
    }
  }

  /** Alias for get */
  getSecret(id: string): string | undefined {
    return this.get(id);
  }

  /** Check if credential exists */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Delete a credential */
  delete(id: string): boolean {
    const deleted = this.entries.delete(id);
    if (deleted) {
      this.log.info({ credentialId: id }, "Credential removed from vault");
      this.persistSync();
    }
    return deleted;
  }

  /** List public metadata for all stored credentials (never returns secrets) */
  list(): StoredCredentialMetadata[] {
    return Array.from(this.entries.values()).map((e) => ({ ...e.metadata }));
  }

  /** Alias for list */
  listCredentials(): StoredCredentialMetadata[] {
    return this.list();
  }

  /** Save vault to disk synchronously */
  private persistSync(): void {
    if (!this.storagePath) return;

    try {
      fsSync.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      const serialized = JSON.stringify(Array.from(this.entries.values()), null, 2);
      fsSync.writeFileSync(this.storagePath, serialized, "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ err: msg }, "Failed to persist encrypted vault to disk");
    }
  }

  /** Load vault from disk asynchronously */
  async load(): Promise<void> {
    if (!this.storagePath) return;

    try {
      const raw = fsSync.readFileSync(this.storagePath, "utf-8");
      const entries: VaultEntry[] = JSON.parse(raw);
      for (const entry of entries) {
        this.entries.set(entry.metadata.id, entry);
      }
      this.log.info({ count: entries.length }, "Loaded encrypted credentials from disk");
    } catch {
      // file does not exist yet
    }
  }
}
