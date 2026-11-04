import { useEffect, useMemo, useRef, useState } from 'react'
import { Shell } from '../chrome'

const MAX = 6000

const EXAMPLES = [
  {
    id: 'sqli',
    label: 'SQL Injection',
    hint: 'Vulnerable',
    code: `def fetch_user_orders(user_email, db):
    query = f"SELECT id, amount, status FROM orders WHERE email = '{user_email}'"
    return db.execute(query).fetchall()
`,
  },
  {
    id: 'osci',
    label: 'OS Command Injection',
    hint: 'Vulnerable',
    code: `import subprocess

def ping_server(hostname):
    command = "ping -c 1 " + hostname
    result = subprocess.check_output(command, shell=True, text=True)
    return result
`,
  },
  {
    id: 'path',
    label: 'Safe Path Traversal',
    hint: 'Mitigated',
    code: `from pathlib import Path
from flask import abort, send_file

def download_report(filename):
    base_dir = Path("/var/app/reports").resolve()
    target_path = (base_dir / filename).resolve()
    
    if target_path != base_dir and base_dir not in target_path.parents:
        abort(403)
        
    return send_file(target_path)
`,
  },
  {
    id: 'ctx',
    label: 'Missing Auth Helper',
    hint: 'Context needed',
    code: `def view_invoice(request, invoice_id, db):
    if not check_invoice_access(request.user, invoice_id):
        return {"error": "unauthorized"}, 403
    return db.get_invoice(invoice_id)
`,
  },
] as const

type StepKey = 'attacker' | 'critic' | 'patcher'
type StepState = 'pending' | 'running' | 'done' | 'skipped'

type Finding = {
  cwe: string
  severity: string
  confidence?: string
  evidence: string
  impact: string
}

type ReviewResult = {
  attacker?: {
    status: string
    findings: Finding[]
    missing_context?: string[]
  }
  critic?: {
    verdict: string
    cwe?: string
    reason?: string
    evidence?: string
    gate?: {
      proceed_to_patcher?: boolean
      evidence_grounded?: boolean | null
      missing_context_grounded?: boolean | null
    }
  }
  patcher?: {
    status: string
    summary?: string
    patch?: string
    patched_code?: string
    regression_tests?: string[]
    checks?: Record<string, boolean>
    failed_checks?: string[]
    human_approval_required?: boolean
  }
  source: 'live' | 'demo'
  note?: string
}

const STEP_CONFIG: Record<
  StepKey,
  { label: string; role: string; desc: string }
> = {
  attacker: {
    label: 'Attacker',
    role: 'Adversarial Scan',
    desc: 'v5 LoRA AST Sink Discovery',
  },
  critic: {
    label: 'Critic',
    role: 'False-Positive Gate',
    desc: 'v1 Specialist Verification',
  },
  patcher: {
    label: 'Patcher',
    role: 'AST Diff Generator',
    desc: 'v3.1 Verified Repair',
  },
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function demoFor(code: string): ReviewResult {
  if (code.includes("WHERE email = '{user_email}'")) {
    return {
      source: 'demo',
      note: 'Backend unreachable. Showing the SQL injection walkthrough from the spec.',
      attacker: {
        status: 'finding',
        findings: [
          {
            cwe: 'CWE-89',
            severity: 'critical',
            confidence: 'high',
            evidence:
              "query = f\"SELECT id, amount, status FROM orders WHERE email = '{user_email}'\"",
            impact: 'Unsanitized user input formatted directly into a SQL query string.',
          },
        ],
      },
      critic: {
        verdict: 'confirmed',
        cwe: 'CWE-89',
        reason:
          'The query is built from caller data by string formatting and executed directly without parameterized binding.',
        evidence:
          "query = f\"SELECT id, amount, status FROM orders WHERE email = '{user_email}'\"",
        gate: { proceed_to_patcher: true, evidence_grounded: true },
      },
      patcher: {
        status: 'patch_proposed',
        summary:
          'Bind user_email as a parameter instead of interpolating it into the query string.',
        patch:
          '--- a/snippet.py\n+++ b/snippet.py\n@@ -1,3 +1,3 @@\n def fetch_user_orders(user_email, db):\n-    query = f"SELECT id, amount, status FROM orders WHERE email = \'{user_email}\'"\n-    return db.execute(query).fetchall()\n+    query = "SELECT id, amount, status FROM orders WHERE email = ?"\n+    return db.execute(query, (user_email,)).fetchall()\n',
        patched_code: `def fetch_user_orders(user_email, db):
    query = "SELECT id, amount, status FROM orders WHERE email = ?"
    return db.execute(query, (user_email,)).fetchall()
`,
        regression_tests: [
          "Passing a quote-containing email (e.g. \"o'brien@domain.com\") treats it as literal data.",
          'Legitimate emails still return expected matching order rows.',
          "Payloads containing ' OR '1'='1 cannot bypass authorization.",
        ],
        checks: {
          parses: true,
          no_new_undefined_names: true,
          evidence_found_in_source: true,
          evidence_area_changed: true,
          diff_applies: true,
          small_change: true,
        },
        human_approval_required: true,
      },
    }
  }
  if (code.includes('subprocess.check_output') && code.includes('shell=True')) {
    return {
      source: 'demo',
      note: 'Backend unreachable. Showing the command-injection walkthrough from the spec.',
      attacker: {
        status: 'finding',
        findings: [
          {
            cwe: 'CWE-78',
            severity: 'critical',
            confidence: 'high',
            evidence: 'command = "ping -c 1 " + hostname',
            impact: 'Untrusted host input is concatenated into a shell command with shell=True.',
          },
        ],
      },
      critic: {
        verdict: 'confirmed',
        cwe: 'CWE-78',
        reason:
          'hostname parameter is concatenated and passed directly to subprocess with shell=True.',
        evidence: 'command = "ping -c 1 " + hostname',
        gate: { proceed_to_patcher: true, evidence_grounded: true },
      },
      patcher: {
        status: 'patch_proposed',
        summary:
          'Pass an argv list and disable the shell so hostname cannot inject extra commands.',
        patch:
          '--- a/snippet.py\n+++ b/snippet.py\n@@ -3,4 +3,3 @@\n def ping_server(hostname):\n-    command = "ping -c 1 " + hostname\n-    result = subprocess.check_output(command, shell=True, text=True)\n+    result = subprocess.check_output(["ping", "-c", "1", hostname], text=True)\n     return result\n',
        patched_code: `import subprocess

def ping_server(hostname):
    result = subprocess.check_output(["ping", "-c", "1", hostname], text=True)
    return result
`,
        checks: {
          parses: true,
          no_new_undefined_names: true,
          evidence_found_in_source: true,
          evidence_area_changed: true,
          diff_applies: true,
          small_change: true,
        },
        regression_tests: [
          'Hostname containing a semicolon or pipe does not execute a secondary process.',
          'Standard IP addresses and domain names ping normally.',
        ],
        human_approval_required: true,
      },
    }
  }
  if (code.includes('base_dir not in target_path.parents')) {
    return {
      source: 'demo',
      note: 'Backend unreachable. Critic correctly rejected this lookalike.',
      attacker: {
        status: 'finding',
        findings: [
          {
            cwe: 'CWE-22',
            severity: 'high',
            confidence: 'medium',
            evidence: 'target_path = (base_dir / filename).resolve()',
            impact: 'Filename from caller is resolved against a filesystem directory.',
          },
        ],
      },
      critic: {
        verdict: 'rejected',
        cwe: 'CWE-22',
        reason:
          'The resolved path is explicitly verified with `base_dir not in target_path.parents`; traversal is properly aborted with 403.',
        evidence:
          'if target_path != base_dir and base_dir not in target_path.parents:',
        gate: {
          proceed_to_patcher: false,
          evidence_grounded: true,
          missing_context_grounded: true,
        },
      },
    }
  }
  if (code.includes('check_invoice_access')) {
    return {
      source: 'demo',
      note: 'Backend unreachable. The helper is not defined in the snippet.',
      attacker: {
        status: 'needs_more_context',
        findings: [],
        missing_context: ['check_invoice_access'],
      },
      critic: {
        verdict: 'needs_more_context',
        reason:
          'Authorization logic depends on `check_invoice_access`, which is not declared in the snippet.',
        gate: {
          proceed_to_patcher: false,
          evidence_grounded: null,
          missing_context_grounded: null,
        },
      },
    }
  }
  return {
    source: 'demo',
    note: 'No live model detected. Load a fixture or start the FastAPI review endpoint.',
    attacker: {
      status: 'needs_more_context',
      findings: [],
      missing_context: ['live model'],
    },
  }
}

async function runLive(
  code: string,
  onStage: (key: StepKey, state: StepState) => void,
) {
  const res = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ code }),
  })
  if (!res.ok || !res.body) throw new Error('review failed')

  const result: ReviewResult = { source: 'live' }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventName = 'message'

  const applyEvent = (name: string, payload: string) => {
    let data: Record<string, unknown> = {}
    try {
      data = JSON.parse(payload) as Record<string, unknown>
    } catch {
      return
    }
    if (name === 'attacker_start') onStage('attacker', 'running')
    if (name === 'attacker_done') {
      onStage('attacker', 'done')
      result.attacker = data as ReviewResult['attacker']
      if (data.status === 'no_finding') {
        onStage('critic', 'skipped')
        onStage('patcher', 'skipped')
      }
    }
    if (name === 'critic_start') onStage('critic', 'running')
    if (name === 'critic_done') {
      onStage('critic', 'done')
      result.critic = data as ReviewResult['critic']
      const gate = data.gate as { proceed_to_patcher?: boolean } | undefined
      if (!gate?.proceed_to_patcher) onStage('patcher', 'skipped')
    }
    if (name === 'patcher_start') onStage('patcher', 'running')
    if (name === 'patcher_done') {
      onStage('patcher', 'done')
      result.patcher = data as ReviewResult['patcher']
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) {
        applyEvent(eventName, line.slice(5).trim())
        eventName = 'message'
      } else if (line.trim() === '') eventName = 'message'
    }
  }
  return result
}

// Styled line-by-line Diff Viewer
function DiffViewer({ patch }: { patch: string }) {
  const lines = useMemo(() => patch.split('\n'), [patch])
  const addCount = useMemo(
    () => lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
    [lines],
  )
  const delCount = useMemo(
    () => lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
    [lines],
  )

  return (
    <div className="diff-viewer">
      <div className="diff-toolbar">
        <span className="diff-file-tag">patch.diff</span>
        <div className="diff-stats">
          <span className="diff-stat-add">+{addCount}</span>
          <span className="diff-stat-del">-{delCount}</span>
        </div>
      </div>
      <div className="diff-lines">
        {lines.map((line, idx) => {
          let type = 'ctx'
          if (line.startsWith('---') || line.startsWith('+++')) type = 'header'
          else if (line.startsWith('@@')) type = 'hunk'
          else if (line.startsWith('+')) type = 'add'
          else if (line.startsWith('-')) type = 'del'

          return (
            <div key={idx} className={`diff-line diff-${type}`}>
              <span className="diff-gutter" aria-hidden="true">
                {type === 'add'
                  ? '+'
                  : type === 'del'
                    ? '−'
                    : type === 'hunk'
                      ? '↕'
                      : ' '}
              </span>
              <span className="diff-text">
                {type === 'add' || type === 'del' ? line.slice(1) : line || ' '}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ReviewPage() {
  const [code, setCode] = useState<string>('')
  const [activeExample, setActiveExample] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [splitPercent, setSplitPercent] = useState<number>(() => {
    const saved =
      typeof window !== 'undefined'
        ? localStorage.getItem('redteamer_split_ratio')
        : null
    return saved ? Math.min(75, Math.max(18, Number(saved))) : 34
  })
  const [isDragging, setIsDragging] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)

  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    attacker: 'pending',
    critic: 'pending',
    patcher: 'pending',
  })
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [openJson, setOpenJson] = useState<string | null>(null)
  const [copiedAction, setCopiedAction] = useState<string | null>(null)
  const [patchAppliedNotice, setPatchAppliedNotice] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!workspaceRef.current) return
      const rect = workspaceRef.current.getBoundingClientRect()
      const offsetX = e.clientX - rect.left
      const newPercent = Math.min(
        75,
        Math.max(18, (offsetX / rect.width) * 100),
      )
      setSplitPercent(newPercent)
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      localStorage.setItem('redteamer_split_ratio', String(splitPercent))
    }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, splitPercent])

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const chars = code.length
  const lines = useMemo(() => code.split('\n'), [code])
  const lineCount = code ? lines.length : 1
  const over = chars > MAX
  const finding = result?.attacker?.findings?.[0]
  const checks = result?.patcher?.checks ?? {}

  const stepBadge = useMemo(() => {
    return {
      attacker:
        result?.attacker?.status === 'finding'
          ? 'Finding detected'
          : result?.attacker?.status === 'no_finding'
            ? 'Clean'
            : result?.attacker?.status ?? steps.attacker,
      critic:
        result?.critic?.verdict === 'confirmed'
          ? 'Confirmed'
          : result?.critic?.verdict === 'rejected'
            ? 'Rejected (Mitigated)'
            : result?.critic?.verdict ?? steps.critic,
      patcher:
        result?.patcher?.status === 'patch_proposed'
          ? 'Proposed'
          : result?.patcher?.status ?? steps.patcher,
    }
  }, [result, steps])

  function setStage(key: StepKey, state: StepState) {
    setSteps((prev) => ({ ...prev, [key]: state }))
  }

  function handleSyncScroll() {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }

  async function copyToClipboard(text: string, actionKey: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAction(actionKey)
      window.setTimeout(() => setCopiedAction(null), 1800)
    } catch {
      // ignore
    }
  }

  function applyPatchToEditor() {
    if (!result?.patcher) return
    const target = result.patcher.patched_code
    if (target) {
      setCode(target)
      setActiveExample('')
      setPatchAppliedNotice(true)
      window.setTimeout(() => setPatchAppliedNotice(false), 3000)
    }
  }

  async function review() {
    if (over || busy || !code.trim()) return
    setBusy(true)
    setResult(null)
    setPatchAppliedNotice(false)
    setSteps({ attacker: 'pending', critic: 'pending', patcher: 'pending' })
    try {
      const live = await runLive(code, setStage)
      setResult(live)
    } catch {
      setStage('attacker', 'running')
      await sleep(380)
      const demo = demoFor(code)
      setResult(demo)
      setStage('attacker', 'done')
      if (demo.critic) {
        setStage('critic', 'running')
        await sleep(340)
        setStage('critic', 'done')
      } else setStage('critic', 'skipped')
      if (demo.patcher) {
        setStage('patcher', 'running')
        await sleep(340)
        setStage('patcher', 'done')
      } else setStage('patcher', 'skipped')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <section className="panel lab">
        {/* Top Control Bar */}
        <header className="lab-toolbar">
          <div className="example-row">
            {EXAMPLES.map((ex) => (
              <button
                key={ex.id}
                type="button"
                className={activeExample === ex.id ? 'is-on' : ''}
                onClick={() => {
                  setActiveExample(ex.id)
                  setCode(ex.code)
                  setResult(null)
                  setPatchAppliedNotice(false)
                }}
              >
                <span>{ex.label}</span>
                <small>{ex.hint}</small>
              </button>
            ))}
          </div>
          <p className="lab-disclaimer">
            Multi-Adapter Pipeline · Adversarial verification · Patches never
            auto-applied
          </p>
          <span className={`lab-count ${over ? 'is-over' : ''}`}>
            {chars.toLocaleString()} / {MAX.toLocaleString()}
          </span>
          <button
            type="button"
            className={`review-btn ${busy ? 'is-busy' : ''}`}
            onClick={review}
            disabled={busy || over || !code.trim()}
          >
            {busy ? (
              <span className="btn-inner">
                <span className="spinner-dot" /> Reviewing…
              </span>
            ) : (
              <span className="btn-inner">
                <svg
                  viewBox="0 0 16 16"
                  className="btn-icon"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <polygon points="5 3 13 8 5 13 5 3" />
                </svg>
                Run review
              </span>
            )}
          </button>
        </header>

        <div
          className={`lab-workspace ${isDragging ? 'is-resizing' : ''}`}
          ref={workspaceRef}
        >
          {/* Left Column: Code Editor */}
          <div
            className="lab-editor"
            style={{ width: `${splitPercent}%`, flex: `0 0 ${splitPercent}%` }}
          >
            <div className="lab-editor-meta">
              <div className="meta-left">
                <span className="file-chip">
                  <span className="live-dot" /> snippet.py
                </span>
                <span className="lang-chip">Python 3.12</span>
                {patchAppliedNotice ? (
                  <span className="badge-patch-applied">
                    ✓ Patch applied to buffer
                  </span>
                ) : null}
              </div>

              <div className="meta-actions">
                <span className="meta-stat">
                  {code ? `${lineCount} ${lineCount === 1 ? 'line' : 'lines'}` : '0 lines'}
                </span>
                <button
                  type="button"
                  className="meta-action-btn"
                  title="Copy code to clipboard"
                  disabled={!code}
                  onClick={() => copyToClipboard(code, 'editor_code')}
                >
                  {copiedAction === 'editor_code' ? (
                    '✓ Copied'
                  ) : (
                    <>
                      <svg
                        viewBox="0 0 16 16"
                        className="btn-icon"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <rect x="5" y="5" width="8" height="8" rx="1.5" />
                        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v5A1.5 1.5 0 0 0 4.5 10H5" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="meta-action-btn"
                  title={activeExample ? 'Reset to fixture' : 'Clear buffer'}
                  disabled={!code}
                  onClick={() => {
                    if (activeExample) {
                      const found = EXAMPLES.find((ex) => ex.id === activeExample)
                      setCode(found ? found.code : '')
                    } else {
                      setCode('')
                    }
                    setResult(null)
                  }}
                >
                  {activeExample ? 'Reset' : 'Clear'}
                </button>
                <span className="shortcut-hint" title="Press Ctrl+Enter to review">
                  Ctrl+↵
                </span>
              </div>
            </div>

            <div className="editor-gutter-wrap">
              {busy ? <div className="scan-laser" aria-hidden="true" /> : null}
              <div
                className="editor-gutter"
                ref={gutterRef}
                aria-hidden="true"
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <span key={i + 1} className="gutter-num">
                    {i + 1}
                  </span>
                ))}
              </div>
              <textarea
                ref={textareaRef}
                value={code}
                spellCheck={false}
                onScroll={handleSyncScroll}
                onChange={(e) => {
                  setActiveExample('')
                  setCode(e.target.value)
                }}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault()
                    review()
                  }
                }}
                aria-label="Python snippet"
                placeholder="# Paste a Python function here or click one of the test fixtures above..."
              />
            </div>
          </div>

          {/* Draggable Resizer Splitter */}
          <div
            className={`lab-resizer ${isDragging ? 'is-active' : ''}`}
            onMouseDown={handleMouseDown}
            title="Click and drag to resize editor and output panes"
          >
            <div className="resizer-handle" />
          </div>

          {/* Right Column: Stepper & Triage Output */}
          <aside
            className="lab-side"
            style={{ width: `${100 - splitPercent}%`, flex: '1 1 0%' }}
          >
            <ol className="stepper">
              {(Object.keys(STEP_CONFIG) as StepKey[]).map((key, i) => {
                const conf = STEP_CONFIG[key]
                const st = steps[key]
                return (
                  <li
                    key={key}
                    className={`step is-${st} ${
                      st === 'running' ? 'pulse-border' : ''
                    }`}
                  >
                    <div className="step-head">
                      <span className="step-index">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`step-indicator indicator-${st}`}>
                        {st === 'running' ? (
                          <span className="pulse-ping" />
                        ) : st === 'done' ? (
                          '✓'
                        ) : st === 'skipped' ? (
                          '—'
                        ) : (
                          '○'
                        )}
                      </span>
                    </div>
                    <div className="step-body">
                      <div className="step-title-row">
                        <strong>{conf.label}</strong>
                        <span className={`status-pill pill-${st}`}>
                          {stepBadge[key]}
                        </span>
                      </div>
                      <small className="step-desc">{conf.role}</small>
                    </div>
                  </li>
                )
              })}
            </ol>

            <div className="lab-output">
              {!result ? (
                <div className="lab-idle">
                  <div className="idle-radar-frame" aria-hidden="true">
                    <svg viewBox="0 0 64 64" className="idle-radar-svg">
                      <circle cx="32" cy="32" r="28" className="radar-circle" />
                      <circle cx="32" cy="32" r="18" className="radar-circle" />
                      <circle cx="32" cy="32" r="8" className="radar-circle" />
                      <line x1="32" y1="4" x2="32" y2="60" className="radar-line" />
                      <line x1="4" y1="32" x2="60" y2="32" className="radar-line" />
                    </svg>
                  </div>
                  <p className="eyebrow">
                    <span className="diamonds" aria-hidden="true">
                      <i />
                      <i />
                    </span>
                    TRIAGE WORKSTATION
                  </p>
                  <h2>
                    Findings, critic gate, and diffs
                    <em> land here.</em>
                  </h2>
                  <p>
                    Load an injection fixture or paste Python on the left. The
                    specialist pipeline inspects the code in 3 adversarial
                    passes:
                  </p>
                  <ul className="idle-features">
                    <li>
                      <span className="num-dot">1</span>
                      <div>
                        <strong>Attacker (shared_v5)</strong> scans for CWE
                        taint sinks and extracts exact line grounded evidence.
                      </div>
                    </li>
                    <li>
                      <span className="num-dot">2</span>
                      <div>
                        <strong>Critic (critic_v1)</strong> verifies mitigating
                        context and gates against false positives.
                      </div>
                    </li>
                    <li>
                      <span className="num-dot">3</span>
                      <div>
                        <strong>Patcher (patcher_v31)</strong> outputs unified
                        diffs verified by Python AST syntax checks.
                      </div>
                    </li>
                  </ul>
                  <div className="idle-shortcut">
                    <span>Press</span>
                    <kbd>Run review</kbd>
                    <span>or</span>
                    <kbd>Ctrl + Enter</kbd>
                  </div>
                </div>
              ) : (
                <div className="results">
                  {/* Quick Navigation Anchor Bar */}
                  <div className="output-quick-nav">
                    <span className="quick-nav-label">JUMP TO:</span>
                    {finding ? (
                      <button
                        type="button"
                        className="quick-nav-pill"
                        onClick={() => scrollToSection('sec-verdict')}
                      >
                        ⚠️ Vulnerability
                      </button>
                    ) : null}
                    {result.critic ? (
                      <button
                        type="button"
                        className="quick-nav-pill"
                        onClick={() => scrollToSection('sec-critic')}
                      >
                        🛡️ Critic Gate
                      </button>
                    ) : null}
                    {result.patcher?.status === 'patch_proposed' ? (
                      <button
                        type="button"
                        className="quick-nav-pill"
                        onClick={() => scrollToSection('sec-patch')}
                      >
                        ✦ Patch Diff
                      </button>
                    ) : null}
                    {result.patcher?.regression_tests?.length ? (
                      <button
                        type="button"
                        className="quick-nav-pill"
                        onClick={() => scrollToSection('sec-tests')}
                      >
                        🧪 Tests
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="quick-nav-expand"
                      onClick={() => {
                        const next = splitPercent <= 24 ? 34 : 20
                        setSplitPercent(next)
                        localStorage.setItem(
                          'redteamer_split_ratio',
                          String(next),
                        )
                      }}
                      title={
                        splitPercent <= 24
                          ? 'Restore 66% width'
                          : 'Maximize output width to 80%'
                      }
                    >
                      {splitPercent <= 24
                        ? '⤡ Restore (66%)'
                        : '⤢ Maximize Output (80%)'}
                    </button>
                  </div>

                  {result.note ? (
                    <div className="demo-notice-bar selectable">
                      <span className="info-icon">ℹ</span>
                      <span>{result.note}</span>
                    </div>
                  ) : null}

                  {/* Vulnerability Verdict Card */}
                  {finding ? (
                    <article id="sec-verdict" className="verdict-card">
                      <div className="verdict-header">
                        <div className="verdict-tags">
                          <span className="cwe-chip">{finding.cwe}</span>
                          <span
                            className={`severity-chip sev-${finding.severity.toLowerCase()}`}
                          >
                            <span className="sev-dot" />
                            {finding.severity.toUpperCase()}
                          </span>
                          {finding.confidence ? (
                            <span className="conf-chip">
                              CONFIDENCE: {finding.confidence.toUpperCase()}
                            </span>
                          ) : null}
                        </div>
                        <span className="triage-status-badge">
                          VULNERABILITY DETECTED
                        </span>
                      </div>

                      <div className="finding-impact-box">
                        <div className="box-label">IMPACT SUMMARY</div>
                        <p className="selectable impact-text">{finding.impact}</p>
                      </div>

                      {/* Evidence block */}
                      <div className="evidence-panel">
                        <div className="evidence-panel-head">
                          <span>GROUNDED TAINT SPAN (SOURCE CODE)</span>
                          <button
                            type="button"
                            className="micro-copy-btn"
                            onClick={() =>
                              copyToClipboard(finding.evidence, 'evidence')
                            }
                          >
                            {copiedAction === 'evidence' ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                        <pre className="evidence-content selectable">
                          {finding.evidence}
                        </pre>
                      </div>

                      {/* Critic Audit Gate Sub-Card */}
                      {result.critic ? (
                        <div
                          id="sec-critic"
                          className={`critic-audit-box is-${result.critic.verdict}`}
                        >
                          <div className="critic-audit-head">
                            <div className="critic-audit-title">
                              <span className="critic-icon">
                                {result.critic.verdict === 'confirmed'
                                  ? '🛡️'
                                  : '✓'}
                              </span>
                              <strong>CRITIC VERIFICATION GATE</strong>
                            </div>
                            <span
                              className={`critic-badge badge-${result.critic.verdict}`}
                            >
                              {result.critic.verdict === 'confirmed'
                                ? 'FINDING CONFIRMED'
                                : result.critic.verdict === 'rejected'
                                  ? 'FALSE POSITIVE REJECTED'
                                  : 'CONTEXT REQUIRED'}
                            </span>
                          </div>
                          {result.critic.reason ? (
                            <p className="critic-reason-text selectable">
                              “{result.critic.reason}”
                            </p>
                          ) : null}
                          <div className="critic-metrics">
                            <span>
                              Proceed to patcher:{' '}
                              <strong>
                                {result.critic.gate?.proceed_to_patcher
                                  ? 'YES'
                                  : 'NO (HALTED)'}
                              </strong>
                            </span>
                            <span>
                              Evidence grounded:{' '}
                              <strong>
                                {result.critic.gate?.evidence_grounded
                                  ? 'GROUNDED'
                                  : 'UNVERIFIED'}
                              </strong>
                            </span>
                          </div>
                        </div>
                      ) : null}
                    </article>
                  ) : (
                    <article className="verdict-card verdict-clean">
                      <div className="clean-head">
                        <span className="clean-icon">✓</span>
                        <div>
                          <h3>No Vulnerability Reported</h3>
                          <p className="selectable">
                            Attacker status: {result.attacker?.status ?? 'clean'}
                            {result.attacker?.missing_context?.length
                              ? ` · Missing external declarations: ${result.attacker.missing_context.join(
                                  ', ',
                                )}`
                              : ' · No active injection or traversal patterns identified.'}
                          </p>
                        </div>
                      </div>
                    </article>
                  )}

                  {/* Patch Proposal Card */}
                  {result.patcher?.status === 'patch_proposed' ? (
                    <article id="sec-patch" className="patch-card">
                      <div className="patch-card-header">
                        <div>
                          <div className="patch-chip-row">
                            <span className="patch-label">AST REMEDIATION</span>
                            <span className="patch-specialist-chip">
                              Patcher v3.1 Specialist
                            </span>
                          </div>
                          <h2>Patch proposal</h2>
                        </div>
                        <div className="patch-actions">
                          {result.patcher.patch ? (
                            <button
                              type="button"
                              className="patch-action-btn"
                              onClick={() =>
                                copyToClipboard(
                                  result.patcher?.patch ?? '',
                                  'patch_diff',
                                )
                              }
                            >
                              {copiedAction === 'patch_diff' ? (
                                '✓ Diff Copied'
                              ) : (
                                <>
                                  <svg
                                    viewBox="0 0 16 16"
                                    className="btn-icon"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.5"
                                  >
                                    <rect
                                      x="5"
                                      y="5"
                                      width="8"
                                      height="8"
                                      rx="1.5"
                                    />
                                    <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-5A1.5 1.5 0 0 0 3 3.5v5A1.5 1.5 0 0 0 4.5 10H5" />
                                  </svg>
                                  Copy Diff
                                </>
                              )}
                            </button>
                          ) : null}

                          {result.patcher.patched_code ? (
                            <button
                              type="button"
                              className="apply-patch-btn"
                              onClick={applyPatchToEditor}
                              title="Replace code on the left with patched version"
                            >
                              Apply to Editor
                            </button>
                          ) : null}
                        </div>
                      </div>

                      <p className="patch-summary-text selectable">
                        {result.patcher.summary}
                      </p>

                      {result.patcher.patch ? (
                        <DiffViewer patch={result.patcher.patch} />
                      ) : null}

                      {/* AST & Safety Validation Checklist */}
                      <div className="checks-section">
                        <span className="checks-title">
                          VALIDATION GATES & AST SAFETY CHECKS
                        </span>
                        <ul className="check-pills">
                          {Object.entries(checks).map(([k, ok]) => (
                            <li key={k} className={ok ? 'ok' : 'bad'}>
                              <span className="check-mark">
                                {ok ? '✓' : '×'}
                              </span>
                              <span>{k.replaceAll('_', ' ')}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Regression Tests */}
                      {result.patcher.regression_tests?.length ? (
                        <div id="sec-tests" className="tests-section">
                          <span className="tests-title">
                            TEST INVARIANTS & REGRESSION SPECS
                          </span>
                          <ul className="tests-list selectable">
                            {result.patcher.regression_tests.map((t, i) => (
                              <li key={i} className="test-item">
                                <span className="test-badge">
                                  TEST {String(i + 1).padStart(2, '0')}
                                </span>
                                <span className="test-body">{t}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </article>
                  ) : null}

                  {/* Telemetry Drawers */}
                  <div className="telemetry-box">
                    <div className="telemetry-header">
                      <span>INSPECT RAW AGENT TELEMETRY</span>
                    </div>
                    <div className="telemetry-items">
                      {(['attacker', 'critic', 'patcher'] as const).map(
                        (key) =>
                          result[key] ? (
                            <details
                              key={key}
                              className="telemetry-detail"
                              open={openJson === key}
                              onToggle={(e) => {
                                if ((e.target as HTMLDetailsElement).open)
                                  setOpenJson(key)
                              }}
                            >
                              <summary>
                                <span className="json-name">{key}.json</span>
                                <span className="json-hint">Click to inspect</span>
                              </summary>
                              <div className="json-pre-wrap">
                                <button
                                  type="button"
                                  className="micro-copy-btn json-copy"
                                  onClick={() =>
                                    copyToClipboard(
                                      JSON.stringify(result[key], null, 2),
                                      `json_${key}`,
                                    )
                                  }
                                >
                                  {copiedAction === `json_${key}`
                                    ? '✓ Copied'
                                    : 'Copy JSON'}
                                </button>
                                <pre className="selectable">
                                  {JSON.stringify(result[key], null, 2)}
                                </pre>
                              </div>
                            </details>
                          ) : null,
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>
    </Shell>
  )
}
