/**
 * @concurrent/tools
 *
 * Unified Tool Execution Layer:
 * - Browser Automation (Playwright)
 * - Filesystem Operations & PathGuard Sandbox
 * - CLI Subprocess Execution
 * - Communication (Email & Notification)
 * - Document Processing (Parse & Generate)
 * - Desktop Automation (Click & Screen capture)
 */

export const TOOLS_MODULE_VERSION = "0.2.0";

// Registration & Catalog
export { getAllTools, registerAllTools } from "./registry/registration.js";
export type { RegisterToolsOptions } from "./registry/registration.js";
export { createStarterTools, registerStarterTools } from "./starter-tools.js";

// Browser
export * from "./browser/index.js";

// Filesystem
export * from "./filesystem/index.js";

// CLI
export * from "./cli/index.js";

// Communication
export * from "./communication/index.js";

// Documents
export * from "./documents/index.js";

// Desktop
export * from "./desktop/index.js";
