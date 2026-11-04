# FRONTEND CONTEXT SPECIFICATION: Security Red-Teamer Prototype

> **Purpose for Cursor / AI Agent:**  
> Use this document as the single source of truth for understanding the backend architecture, data contracts, model execution pipeline, and API design. You do not need to scan the codebase or model weights to build the frontend.

---

## 1. Project Overview & Philosophy

**Security Red-Teamer** is an experimental, defensive, multi-agent AI code review and automated patch proposal system for Python snippets (<= 6,000 characters).

### Key System Principles:
1. **Adversarial Multi-Agent Validation**: Uses three sequential specialized agents (**Attacker ➔ Critic ➔ Patcher**) to minimize hallucinations and false positives.
2. **Strict Read-Only Guarantee**: The tool **never** writes or applies changes to disk. It only produces patch suggestions and unified diff previews for human review.
3. **Deterministic AST & Git Guardrails**: A proposed patch must pass strict programmatic checks (Python `ast.parse`, scope analysis for undefined variables, simulated `git apply --check`, and change size constraints <= 60 lines) before a diff is displayed.

---

## 2. Model & Pipeline Architecture

All three agents run on a single in-memory **Qwen/Qwen3-4B** base model (4-bit NF4 quantized via `bitsandbytes`) with dynamic PEFT LoRA adapter switching on an NVIDIA GPU (RTX 4050 Laptop GPU, ~4-6 GB VRAM):

1. **Stage 1: Attacker** (`security-redteamer-qwen3-lora-v5`, rank $r=8$)
   * Performs static analysis on untrusted Python code.
   * Identifies CWEs, severity, and quotes the exact vulnerable line.
   * Outputs status: `finding`, `no_finding`, or `needs_more_context`.
   * *If `no_finding`: Pipeline halts early.*

2. **Stage 2: Critic Specialist** (`critic_agent/critic_v1_export/adapter`, rank $r=16$)
   * Adversarial auditor that verifies the Attacker's finding against visible code.
   * Filters out false positives (e.g., existing sanitizers or safe containment).
   * Verifies evidence grounding (quoted line must exist in source).
   * Outputs verdict: `confirmed`, `rejected`, or `needs_more_context`.
   * *Gate Check: Only a grounded `confirmed` verdict unlocks Stage 3.*

3. **Stage 3: Patcher Specialist** (`patcher_agent/patcher_v31_export/adapter`, rank $r=32$)
   * Generates minimal, targeted line-replacement blocks (`old` / `new`).
   * Proposes conceptual regression test ideas.
   * Feeds the raw edits into the deterministic AST validation engine ([`patcher_runtime.py`](file:///d:/projects/RedTeamer/patcher_agent/patcher_v31_export/patcher_runtime.py)) to generate a standard unified diff.

---

## 3. Data Contracts & JSON Schemas

### Input Contract
* **Payload**: Single Python code snippet as a string (`max_length: 6000` chars).

---

### Agent 1: Attacker Output Schema
```json
{
  "agent": "attacker",
  "status": "finding" | "no_finding" | "needs_more_context",
  "findings": [
    {
      "cwe": "CWE-89" | "CWE-78" | "CWE-22" | "CWE-79" | "CWE-798" | "CWE-502" | string,
      "severity": "critical" | "high" | "medium" | "low" | "info",
      "confidence": "high" | "medium" | "low",
      "evidence": "query = f\"SELECT * FROM users WHERE id = '{user_id}'\"",
      "impact": "Unsanitized user input formatted directly into query.",
      "safe_validation": "Static review only; no untrusted input was executed."
    }
  ],
  "missing_context": []
}
```

---

### Agent 2: Critic Specialist Output Schema
```json
{
  "verdict": "confirmed" | "rejected" | "needs_more_context",
  "cwe": "CWE-89",
  "reason": "The query is built from request data by string formatting and executed directly.",
  "evidence": "query = f\"SELECT * FROM users WHERE id = '{user_id}'\"",
  "missing_context": [],
  "gate": {
    "proceed_to_patcher": true | false,
    "evidence_grounded": true | false | null,
    "missing_context_grounded": true | false | null
  }
}
```
* **Gate Logic**:
  * `gate.proceed_to_patcher == true` only when `verdict == "confirmed"` and `evidence_grounded == true`.
  * If `verdict == "rejected"`, `gate.proceed_to_patcher == false`.
  * If `verdict == "needs_more_context"`, pipeline reports missing functions/middleware.

---

### Agent 3: Patcher Specialist & AST Validator Output Schema
```json
{
  "status": "patch_proposed" | "no_patch",
  "summary": "Bind user_id as a parameter instead of concatenating it into the query string.",
  "edits": [
    {
      "old": "    query = f\"SELECT * FROM users WHERE id = '{user_id}'\"\n    return db.execute(query).fetchall()",
      "new": "    query = \"SELECT * FROM users WHERE id = ?\"\n    return db.execute(query, (user_id,)).fetchall()"
    }
  ],
  "regression_tests": [
    "Test that passing a quote-containing ID treats it as literal data.",
    "Verify legitimate user IDs continue returning expected records."
  ],
  "patch": "--- a/snippet.py\n+++ b/snippet.py\n@@ -1,3 +1,3 @@\n...",
  "patched_code": "def get_user_records(user_id, db):\n...",
  "checks": {
    "parses": true,
    "no_new_undefined_names": true,
    "evidence_found_in_source": true,
    "evidence_area_changed": true,
    "diff_applies": true,
    "small_change": true
  },
  "failed_checks": [],
  "human_approval_required": true,
  "applied": false,
  "quote_repair": null
}
```

---

## 4. Recommended Backend API Specification (FastAPI)

If creating a decoupled FastAPI backend (`server.py`), implement these 3 endpoints:

### 1. `POST /api/model/load`
* **Purpose**: Triggers `load_model()` to load Qwen3-4B and mount the 3 LoRA adapters.
* **Response**:
  ```json
  {
    "status": "ready",
    "device": "NVIDIA GeForce RTX 4050 Laptop GPU",
    "adapters": ["shared_v5", "critic_v1", "patcher_v31"]
  }
  ```

### 2. `GET /api/model/status`
* **Response**:
  ```json
  {
    "is_loaded": true,
    "memory_usage_mb": 4200
  }
  ```

### 3. `POST /api/review` (Server-Sent Events / SSE Streaming)
* **Request**: `{"code": "..."}`
* **Stream Events**:
  1. `event: attacker_start` $\rightarrow$ `{"stage": "attacker", "message": "Analyzing code..."}`
  2. `event: attacker_done` $\rightarrow$ `{ ...Attacker JSON... }`
  3. `event: critic_start` $\rightarrow$ `{"stage": "critic", "message": "Verifying finding..."}`
  4. `event: critic_done` $\rightarrow$ `{ ...Critic JSON with gate... }`
  5. `event: patcher_start` $\rightarrow$ `{"stage": "patcher", "message": "Generating AST patch..."}`
  6. `event: patcher_done` $\rightarrow$ `{ ...Patcher JSON with diff & checks... }`
  7. `event: complete` $\rightarrow$ `{"status_message": "Review complete..."}`

---

## 5. Frontend UI/UX Requirements

### Visual Theme & Aesthetic
* **Theme**: Modern Cybersecurity / Developer Tool (Dark mode, Slate/Zinc neutral background, Emerald for safe/fixed, Crimson for vulnerabilities, Amber for warnings/context).
* **Typography**: Clean sans-serif for UI (`Inter` or `Geist`), Monospace for code (`Fira Code` or `JetBrains Mono`).

### Layout & Component Hierarchy
1. **Header**:
   * App title & branding: **Security Red-Teamer**
   * Model status indicator pill: `Model Ready (GPU: RTX 4050)` or `Not Loaded` with a "Load Model" button.
   * Safety disclaimer banner: *"Experimental review aid. All proposals require human review."*

2. **Code Input Panel**:
   * **Monaco Editor** with Python syntax highlighting.
   * Character counter (`X / 6,000`).
   * **1-Click Preloaded Test Example Buttons**:
     * Button 1: `SQL Injection (Vulnerable)`
     * Button 2: `OS Command Injection (Vulnerable)`
     * Button 3: `Safe Path Traversal (Mitigated)`
     * Button 4: `Missing Auth Helper (Context Needed)`
   * Large Action Button: **"Review Code"** (with loading spinner during inference).

3. **Multi-Agent Pipeline Stepper**:
   * Horizontal visual stepper showing real-time execution nodes:
     * **Step 1: Attacker** [Pending / Running / Finding Flagged / No Finding / Needs Context]
     * **Step 2: Critic** [Pending / Running / Confirmed / Rejected / Needs Context]
     * **Step 3: Patcher** [Pending / Running / Patch Proposed / Skipped / Rejected by Checks]

4. **Results & Triage Dashboard**:
   * **Verdict Alert Card**:
     * CWE Badge (e.g. `CWE-89: SQL Injection`)
     * Severity Pill (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`)
     * Impact summary
     * Quoted evidence block with line number indicator.
     * Critic justification explanation.
   * **Patch & Diff Section** (Visible only if patch proposed):
     * **Monaco DiffEditor** with side-by-side (Split) or inline unified diff view.
     * **Safety Verification Checklist** (Pills showing AST Parse: ✅, Scope Valid: ✅, Git Apply: ✅, Minimal Diff: ✅).
     * **Regression Test Ideas**: Bulleted cards of suggested test cases.
   * **Developer Telemetry Accordion**:
     * Expandable tabs for raw JSON inspection of Attacker, Critic, and Patcher outputs.

---

## 6. Pre-Loaded Test Cases for the UI

Use these exact snippets for the pre-loaded example buttons:

### Example 1: SQL Injection (Triggers full 3-stage patch)
```python
def fetch_user_orders(user_email, db):
    query = f"SELECT id, amount, status FROM orders WHERE email = '{user_email}'"
    return db.execute(query).fetchall()
```

### Example 2: OS Command Injection (Triggers command list patch)
```python
import subprocess

def ping_server(hostname):
    command = "ping -c 1 " + hostname
    result = subprocess.check_output(command, shell=True, text=True)
    return result
```

### Example 3: Safe Lookalike (Critic Rejection Demonstration)
```python
from pathlib import Path
from flask import abort, send_file

def download_report(filename):
    base_dir = Path("/var/app/reports").resolve()
    target_path = (base_dir / filename).resolve()
    
    if target_path != base_dir and base_dir not in target_path.parents:
        abort(403)
        
    return send_file(target_path)
```

### Example 4: Missing Context (Needs More Context Demonstration)
```python
def view_invoice(request, invoice_id, db):
    if not check_invoice_access(request.user, invoice_id):
        return {"error": "unauthorized"}, 403
    return db.get_invoice(invoice_id)
```

---

## 7. File Map & Code Locations

* Orchestration & Generation Logic: [`app.py`](file:///d:/projects/RedTeamer/app.py)
* AST Engine, Diff Generator & Guardrails: [`patcher_agent/patcher_v31_export/patcher_runtime.py`](file:///d:/projects/RedTeamer/patcher_agent/patcher_v31_export/patcher_runtime.py)
* Critic Verification Gate: [`critic_agent/critic_v1_export/critic_runtime.py`](file:///d:/projects/RedTeamer/critic_agent/critic_v1_export/critic_runtime.py)
* Training History & Documentation: [`README.md`](file:///d:/projects/RedTeamer/README.md)

