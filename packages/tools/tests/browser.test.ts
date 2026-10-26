import { describe, it, expect, afterAll } from "vitest";
import {
  BrowserNavigateTool,
  BrowserTypeTool,
  BrowserClickTool,
  BrowserScreenshotTool,
  BrowserExtractTool,
  closeSharedBrowserSession,
} from "../src/browser/index.js";
import { resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";

describe("Phase 2 Milestone — 3-Step Browser Workflow", () => {
  const evidenceDir = resolve("./tmp/browser-evidence");
  const dummyContext = {
    taskId: "browser-milestone-task",
    stepId: 1,
    workingDir: evidenceDir,
    previousOutputs: new Map(),
    allowedDomains: [],
    allowedPaths: [],
    dryRun: false,
  };

  afterAll(async () => {
    await closeSharedBrowserSession();
    if (existsSync(evidenceDir)) {
      rmSync(evidenceDir, { recursive: true, force: true });
    }
  });

  it("should complete a 3-step browser workflow: navigate to a form, fill input, submit, and capture screenshot evidence", async () => {
    const htmlPage = `
      <!DOCTYPE html>
      <html>
        <head><title>Company Expense Submission</title></head>
        <body>
          <h1>Expense Form</h1>
          <form id="expense-form" onsubmit="event.preventDefault(); document.getElementById('status').innerText = 'Report Submitted: ' + document.getElementById('report-name').value;">
            <input type="text" id="report-name" placeholder="Report Title" />
            <button type="submit" id="submit-btn">Submit Report</button>
          </form>
          <div id="status">Pending</div>
        </body>
      </html>
    `;
    const formUrl = `data:text/html;charset=utf-8,${encodeURIComponent(htmlPage)}`;

    // Step 1: Navigate to form page
    const navTool = new BrowserNavigateTool();
    const navResult = await navTool.execute({ url: formUrl }, { ...dummyContext, stepId: 1 });
    expect(navResult.success).toBe(true);
    expect(navResult.output.title).toBe("Company Expense Submission");
    expect(navResult.evidence.length).toBeGreaterThan(0);

    // Step 2: Fill input and click submit
    const typeTool = new BrowserTypeTool();
    const typeResult = await typeTool.execute(
      { selector: "#report-name", text: "Q3 Marketing Expenses" },
      { ...dummyContext, stepId: 2 },
    );
    expect(typeResult.success).toBe(true);

    const clickTool = new BrowserClickTool();
    const clickResult = await clickTool.execute({ selector: "#submit-btn" }, { ...dummyContext, stepId: 3 });
    expect(clickResult.success).toBe(true);

    // Extract updated status text
    const extractTool = new BrowserExtractTool();
    const extractResult = await extractTool.execute({ selector: "#status" }, { ...dummyContext, stepId: 4 });
    expect(extractResult.output.text).toBe("Report Submitted: Q3 Marketing Expenses");

    // Step 3: Capture screenshot of the resulting page
    const screenshotTool = new BrowserScreenshotTool();
    const screenshotResult = await screenshotTool.execute({ name: "form-submitted" }, { ...dummyContext, stepId: 5 });
    expect(screenshotResult.success).toBe(true);
    expect(existsSync(String(screenshotResult.output.filePath))).toBe(true);
    expect(screenshotResult.evidence[0].type).toBe("screenshot");
  });
});
