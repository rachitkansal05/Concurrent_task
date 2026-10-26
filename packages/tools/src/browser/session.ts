/**
 * Browser Session Manager
 *
 * Manages the lifecycle of Playwright Browser, BrowserContext, and Page instances.
 * Enforces allowed domain restrictions and manages evidence screenshots.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { resolve, join } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { ToolError, createLogger } from "@concurrent/core";

const log = createLogger({ component: "browser-session" });

export interface BrowserSessionOptions {
  headless?: boolean;
  navigationTimeoutMs?: number;
  allowedDomains?: string[];
  evidenceDir?: string;
}

export class BrowserSessionManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  private headless: boolean;
  private navigationTimeoutMs: number;
  private allowedDomains: string[];
  private evidenceDir: string;

  constructor(options: BrowserSessionOptions = {}) {
    this.headless = options.headless ?? true;
    this.navigationTimeoutMs = options.navigationTimeoutMs ?? 30000;
    this.allowedDomains = options.allowedDomains ?? [];
    this.evidenceDir = resolve(options.evidenceDir ?? "./evidence");

    if (!existsSync(this.evidenceDir)) {
      mkdirSync(this.evidenceDir, { recursive: true });
    }
  }

  /**
   * Ensure browser and active page are running.
   */
  async getPage(): Promise<Page> {
    if (!this.browser || !this.browser.isConnected()) {
      log.debug({ headless: this.headless }, "Launching Chromium browser instance");
      this.browser = await chromium.launch({
        headless: this.headless,
      });

      this.context = await this.browser.newContext({
        viewport: { width: 1280, height: 800 },
        userAgent: "Concurrent-AI-Employee/0.1.0",
      });

      this.context.setDefaultTimeout(this.navigationTimeoutMs);
    }

    if (!this.activePage || this.activePage.isClosed()) {
      this.activePage = await this.context!.newPage();
    }

    return this.activePage;
  }

  /**
   * Check if a URL is permitted under allowedDomains.
   */
  isDomainAllowed(urlString: string): boolean {
    if (this.allowedDomains.length === 0) {
      return true; // No restrictions specified
    }

    try {
      const parsed = new URL(urlString);
      const hostname = parsed.hostname.toLowerCase();

      return this.allowedDomains.some((allowed) => {
        const normalized = allowed.toLowerCase().trim();
        return hostname === normalized || hostname.endsWith(`.${normalized}`);
      });
    } catch {
      return false;
    }
  }

  /**
   * Capture a screenshot of the active page and store as an evidence artifact.
   */
  async captureScreenshot(namePrefix = "step"): Promise<{ path: string; buffer: Buffer }> {
    const page = await this.getPage();
    const timestamp = Date.now();
    const filename = `${namePrefix}-${timestamp}.png`;
    const filePath = join(this.evidenceDir, filename);

    const buffer = await page.screenshot({
      path: filePath,
      fullPage: false,
    });

    log.debug({ filePath }, "Captured page screenshot evidence");
    return { path: filePath, buffer };
  }

  /**
   * Close the browser and all associated contexts.
   */
  async close(): Promise<void> {
    if (this.activePage && !this.activePage.isClosed()) {
      await this.activePage.close();
      this.activePage = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      log.debug("Browser session closed");
    }
  }
}

// Global shared session instance for the operator process
let sharedSession: BrowserSessionManager | null = null;

export function getSharedBrowserSession(options?: BrowserSessionOptions): BrowserSessionManager {
  if (!sharedSession) {
    sharedSession = new BrowserSessionManager(options);
  }
  return sharedSession;
}

export async function closeSharedBrowserSession(): Promise<void> {
  if (sharedSession) {
    await sharedSession.close();
    sharedSession = null;
  }
}
