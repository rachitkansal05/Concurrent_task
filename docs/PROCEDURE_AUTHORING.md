# Standard Operating Procedure (SOP) Authoring Guide

Business Analysts and System Administrators can encode company workflows into YAML procedures so the Autonomous Operator executes them deterministically without hallucinations.

## 1. Procedure File Location

Procedures are stored in `config/procedures/*.yaml`. All files placed in this directory are automatically loaded and indexed at startup.

## 2. Procedure File Schema

```yaml
id: expense-submission-v1
name: Monthly Expense Reimbursement
version: 1.0.0
description: Submits monthly employee expenses into the financial ERP system.

# Natural language trigger phrases matched by the context engine
triggers:
  - "submit my expenses"
  - "file monthly reimbursement"
  - "process my expense receipts"

# Roles authorized to invoke this procedure
requiredRoles:
  - employee
  - contractor

# Target systems accessed during execution
systems:
  - Expensify
  - Slack

# Deterministic sequential steps
steps:
  - id: 1
    action: file.list
    description: Scan employee receipts directory for PDF files
    params:
      directory: "{{user_workspace}}/receipts"
      pattern: "*.pdf"

  - id: 2
    action: browser.navigate
    description: Open corporate expense portal
    params:
      url: "https://expenses.internal.company.com/login"

  - id: 3
    action: browser.type
    description: Fill expense total
    params:
      selector: "input#amount"
      text: "{{amount}}"

  - id: 4
    action: notify.send
    description: Notify user of submission confirmation
    params:
      channel: "direct-message"
      message: "Expense report #{{report_id}} submitted successfully."

# Expected outcomes to be cryptographically verified by the Verifier Engine
expectedOutcomes:
  - type: file_exists
    path: "{{user_workspace}}/receipts/submitted.log"
  - type: dom_state
    selector: ".submission-confirmation-banner"
    expectedText: "Submission Complete"
```

## 3. Best Practices

1. **Keep Triggers Diverse**: Include at least 3-5 variations of common phrasing employees might use.
2. **Explicit Verification**: Always define `expectedOutcomes` so the operator gathers hard evidence before marking a task complete.
3. **Template Variables**: Use `{{variable}}` syntax. The context engine automatically resolves dynamic parameters from user input.
