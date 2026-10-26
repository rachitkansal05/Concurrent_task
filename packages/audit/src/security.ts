/**
 * Unified Security & Audit Gateway
 *
 * Single coordinated entry point for:
 *   - Encrypted Credential Vault
 *   - Immutable Audit Trail
 *   - Permission Enforcement
 *   - Data Classification
 *   - Log Redaction
 *   - Network Security
 */

import { createLogger } from "@concurrent/core";
import { LogRedactor } from "./redaction/redactor.js";
import { CredentialVault, CredentialVaultOptions } from "./credentials/vault.js";
import { ImmutableAuditTrail, AuditTrailOptions } from "./audit/trail.js";
import { PermissionEnforcer, PermissionRule } from "./permissions/enforcer.js";
import { DataClassifier } from "./classification/classifier.js";
import { NetworkSecurityGuard } from "./network/security.js";
import type { NetworkSecurityPolicy } from "./types.js";

export interface SecurityGatewayOptions {
  masterKey?: string;
  vaultStoragePath?: string;
  auditLogPath?: string;
  vaultOptions?: CredentialVaultOptions;
  auditOptions?: AuditTrailOptions;
  permissionRules?: PermissionRule[];
  networkPolicy?: Partial<NetworkSecurityPolicy>;
}

export class SecurityGateway {
  private log = createLogger({ component: "security-gateway" });
  readonly redactor: LogRedactor;
  readonly vault: CredentialVault;
  readonly audit: ImmutableAuditTrail;
  readonly permissions: PermissionEnforcer;
  readonly classifier: DataClassifier;
  readonly network: NetworkSecurityGuard;

  constructor(options: SecurityGatewayOptions = {}) {
    this.redactor = new LogRedactor();

    this.vault = new CredentialVault({
      masterKey: options.masterKey,
      storagePath: options.vaultStoragePath,
      ...options.vaultOptions,
      redactor: this.redactor,
    });

    this.audit = new ImmutableAuditTrail({
      storagePath: options.auditLogPath,
      ...options.auditOptions,
      redactor: this.redactor,
    });

    this.permissions = new PermissionEnforcer(this.audit, options.permissionRules);
    this.classifier = new DataClassifier();
    this.network = new NetworkSecurityGuard(options.networkPolicy);

    this.log.info("SecurityGateway initialized with all submodules");
  }

  /** Alias for permissions */
  get enforcer(): PermissionEnforcer {
    return this.permissions;
  }
}
