# Concurrent Tool Catalog

Complete reference of all execution tools available to the Autonomous Operator.

## 1. Browser Tools (`@concurrent/tools/browser`)

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `browser.navigate` | Low | Navigate active browser session to URL | `url: string` |
| `browser.click` | Medium | Click element matched by CSS/text selector | `selector: string`, `timeout?: number` |
| `browser.type` | Medium | Type text or fill input field | `selector: string`, `text: string`, `secret?: boolean` |
| `browser.extract` | Low | Extract text content or attributes from DOM | `selector: string`, `attribute?: string` |
| `browser.screenshot` | Low | Capture viewport or full-page PNG | `fullPage?: boolean`, `path?: string` |
| `browser.download` | Medium | Trigger file download and save locally | `selector: string`, `destinationDir: string` |
| `browser.wait` | Low | Wait for element selector or time delay | `selector?: string`, `durationMs?: number` |

## 2. Filesystem Tools (`@concurrent/tools/filesystem`)

*All operations are bounded inside sandbox paths enforced by `PathGuard`.*

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `file.read` | Low | Read UTF-8 or binary file content | `path: string` |
| `file.write` | Medium | Write content to specified file path | `path: string`, `content: string` |
| `file.list` | Low | List files and directories matching glob | `directory: string`, `pattern?: string` |
| `file.move` | Medium | Move or rename file | `source: string`, `destination: string` |
| `file.delete` | High | Delete file or directory (approval recommended) | `path: string` |
| `file.exists` | Low | Check if path exists on disk | `path: string` |

## 3. Communication Tools (`@concurrent/tools/communication`)

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `email.send` | Medium | Send email via SMTP / corporate gateway | `to: string`, `subject: string`, `body: string`, `attachments?: string[]` |
| `notify.send` | Low | Send Slack/Teams chat alert | `channel: string`, `message: string`, `level?: string` |

## 4. Document & Data Tools (`@concurrent/tools/documents`)

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `document.parse` | Low | Extract text and metadata from PDF/CSV/Markdown | `path: string` |
| `document.generate` | Medium | Render PDF or Markdown report from template | `template: string`, `data: object`, `outputPath: string` |

## 5. System Execution Tools (`@concurrent/tools/cli`)

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `cli.execute` | High | Execute isolated shell command | `command: string`, `args: string[]`, `cwd?: string`, `timeout?: number` |

## 6. Desktop UI Automation Tools (`@concurrent/tools/desktop`)

| Tool Name | Risk Level | Description | Key Parameters |
|---|---|---|---|
| `desktop.click` | High | Send synthetic mouse click at (x, y) coordinates | `x: number`, `y: number`, `button?: "left" \| "right"` |
| `desktop.screenshot` | Low | Capture active desktop display screenshot | `displayIndex?: number` |
