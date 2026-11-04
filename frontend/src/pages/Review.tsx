import { useMemo, useState } from 'react'
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
    gate?: { proceed_to_patcher?: boolean; evidence_grounded?: boolean | null }
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

const STEP_LABEL: Record<StepKey, string> = {
  attacker: 'Attacker',
  critic: 'Critic',
  patcher: 'Patcher',
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
            evidence: "query = f\"SELECT id, amount, status FROM orders WHERE email = '{user_email}'\"",
            impact: 'Unsanitized user input formatted directly into a SQL query.',
          },
        ],
      },
      critic: {
        verdict: 'confirmed',
        cwe: 'CWE-89',
        reason: 'The query is built from caller data by string formatting and executed directly.',
        evidence: "query = f\"SELECT id, amount, status FROM orders WHERE email = '{user_email}'\"",
        gate: { proceed_to_patcher: true, evidence_grounded: true },
      },
      patcher: {
        status: 'patch_proposed',
        summary: 'Bind user_email as a parameter instead of interpolating it into the query string.',
        patch:
          '--- a/snippet.py\n+++ b/snippet.py\n@@ -1,3 +1,3 @@\n def fetch_user_orders(user_email, db):\n-    query = f"SELECT id, amount, status FROM orders WHERE email = \'{user_email}\'"\n-    return db.execute(query).fetchall()\n+    query = "SELECT id, amount, status FROM orders WHERE email = ?"\n+    return db.execute(query, (user_email,)).fetchall()\n',
        regression_tests: [
          'Passing a quote-containing email treats it as literal data.',
          'Legitimate emails still return expected order rows.',
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
            impact: 'Host input is concatenated into a shell command.',
          },
        ],
      },
      critic: {
        verdict: 'confirmed',
        cwe: 'CWE-78',
        reason: 'hostname is concatenated and executed with shell=True.',
        evidence: 'command = "ping -c 1 " + hostname',
        gate: { proceed_to_patcher: true, evidence_grounded: true },
      },
      patcher: {
        status: 'patch_proposed',
        summary: 'Pass a argv list and disable the shell so hostname cannot inject extra commands.',
        checks: {
          parses: true,
          no_new_undefined_names: true,
          evidence_found_in_source: true,
          evidence_area_changed: true,
          diff_applies: true,
          small_change: true,
        },
        regression_tests: ['Hostname with a semicolon does not run a second command.'],
        human_approval_required: true,
      },
    }
  }
  if (code.includes('base_dir not in target_path.parents')) {
    return {
      source: 'demo',
      note: 'Backend unreachable. Critic should reject this lookalike.',
      attacker: {
        status: 'finding',
        findings: [
          {
            cwe: 'CWE-22',
            severity: 'high',
            confidence: 'medium',
            evidence: 'target_path = (base_dir / filename).resolve()',
            impact: 'Filename from the caller is joined onto a filesystem path.',
          },
        ],
      },
      critic: {
        verdict: 'rejected',
        cwe: 'CWE-22',
        reason: 'The resolved path is contained under base_dir; traversal is aborted with 403.',
        evidence: 'if target_path != base_dir and base_dir not in target_path.parents:',
        gate: { proceed_to_patcher: false, evidence_grounded: true },
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
        reason: 'Authorization depends on a helper that is not visible in the snippet.',
        gate: { proceed_to_patcher: false, evidence_grounded: null },
      },
    }
  }
  return {
    source: 'demo',
    note: 'No live model. Load a canned example or start the FastAPI review endpoint.',
    attacker: { status: 'needs_more_context', findings: [], missing_context: ['live model'] },
  }
}

async function runLive(code: string, onStage: (key: StepKey, state: StepState) => void) {
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

export function ReviewPage() {
  const [code, setCode] = useState<string>(EXAMPLES[0].code)
  const [activeExample, setActiveExample] = useState<string>(EXAMPLES[0].id)
  const [busy, setBusy] = useState(false)
  const [steps, setSteps] = useState<Record<StepKey, StepState>>({
    attacker: 'pending',
    critic: 'pending',
    patcher: 'pending',
  })
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [openJson, setOpenJson] = useState<string | null>(null)

  const chars = code.length
  const over = chars > MAX
  const finding = result?.attacker?.findings?.[0]
  const checks = result?.patcher?.checks ?? {}

  const stepCaption = useMemo(
    () => ({
      attacker: result?.attacker?.status ?? steps.attacker,
      critic: result?.critic?.verdict ?? steps.critic,
      patcher: result?.patcher?.status ?? steps.patcher,
    }),
    [result, steps],
  )

  function setStage(key: StepKey, state: StepState) {
    setSteps((prev) => ({ ...prev, [key]: state }))
  }

  async function review() {
    if (over || busy) return
    setBusy(true)
    setResult(null)
    setSteps({ attacker: 'pending', critic: 'pending', patcher: 'pending' })
    try {
      const live = await runLive(code, setStage)
      setResult(live)
    } catch {
      setStage('attacker', 'running')
      await sleep(420)
      const demo = demoFor(code)
      setResult(demo)
      setStage('attacker', 'done')
      if (demo.critic) {
        setStage('critic', 'running')
        await sleep(360)
        setStage('critic', 'done')
      } else setStage('critic', 'skipped')
      if (demo.patcher) {
        setStage('patcher', 'running')
        await sleep(360)
        setStage('patcher', 'done')
      } else setStage('patcher', 'skipped')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <section className="panel lab">
        <div className="panel-head compact">
          <p className="eyebrow">
            <span className="diamonds" aria-hidden="true">
              <i />
              <i />
            </span>
            PYTHON SNIPPET · {MAX.toLocaleString()} CHAR LIMIT
          </p>
          <h1>
            <span className="line">
              Review, then <em>doubt</em> it.
            </span>
          </h1>
          <p className="lede selectable">
            Experimental review aid. All proposals require human review. The tool never applies a
            patch.
          </p>
        </div>

        <div className="lab-grid">
          <div className="handle-box editor-wrap">
            <i className="handle tl" />
            <i className="handle tr" />
            <i className="handle bl" />
            <i className="handle br" />
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
                  }}
                >
                  {ex.label}
                  <small>{ex.hint}</small>
                </button>
              ))}
            </div>
            <textarea
              value={code}
              spellCheck={false}
              onChange={(e) => {
                setActiveExample('')
                setCode(e.target.value)
              }}
              aria-label="Python snippet"
            />
            <div className="editor-bar">
              <span className={over ? 'is-over' : ''}>
                {chars.toLocaleString()} / {MAX.toLocaleString()}
              </span>
              <button type="button" className="review-btn" onClick={review} disabled={busy || over}>
                {busy ? 'Reviewing…' : 'Review Code'}
              </button>
            </div>
          </div>

          <ol className="stepper">
            {(Object.keys(STEP_LABEL) as StepKey[]).map((key, i) => (
              <li key={key} className={`step is-${steps[key]}`}>
                <span>{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{STEP_LABEL[key]}</strong>
                  <em>{stepCaption[key]}</em>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {result ? (
          <div className="results">
            {result.note ? <p className="demo-note selectable">{result.note}</p> : null}

            {finding ? (
              <article className="handle-box verdict">
                <i className="handle tl" />
                <i className="handle tr" />
                <i className="handle bl" />
                <i className="handle br" />
                <div className="verdict-top">
                  <span className="cwe">{finding.cwe}</span>
                  <span className={`sev sev-${finding.severity}`}>{finding.severity}</span>
                </div>
                <p className="selectable">{finding.impact}</p>
                <pre className="evidence selectable">{finding.evidence}</pre>
                {result.critic?.reason ? (
                  <p className="critic-reason selectable">
                    Critic ({result.critic.verdict}): {result.critic.reason}
                  </p>
                ) : null}
              </article>
            ) : (
              <article className="handle-box verdict">
                <i className="handle tl" />
                <i className="handle tr" />
                <i className="handle bl" />
                <i className="handle br" />
                <p className="selectable">
                  Attacker status: {result.attacker?.status ?? 'unknown'}
                  {result.attacker?.missing_context?.length
                    ? ` · missing ${result.attacker.missing_context.join(', ')}`
                    : ''}
                </p>
              </article>
            )}

            {result.patcher?.status === 'patch_proposed' ? (
              <article className="handle-box patch-card">
                <i className="handle tl" />
                <i className="handle tr" />
                <i className="handle bl" />
                <i className="handle br" />
                <h2>Patch proposal</h2>
                <p className="selectable">{result.patcher.summary}</p>
                {result.patcher.patch ? (
                  <pre className="diff selectable">{result.patcher.patch}</pre>
                ) : null}
                <ul className="check-pills">
                  {Object.entries(checks).map(([k, ok]) => (
                    <li key={k} className={ok ? 'ok' : 'bad'}>
                      {ok ? '✓' : '×'} {k.replaceAll('_', ' ')}
                    </li>
                  ))}
                </ul>
                {result.patcher.regression_tests?.length ? (
                  <ul className="tests selectable">
                    {result.patcher.regression_tests.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}

            <div className="telemetry">
              {(['attacker', 'critic', 'patcher'] as const).map((key) =>
                result[key] ? (
                  <details
                    key={key}
                    open={openJson === key}
                    onToggle={(e) => {
                      if ((e.target as HTMLDetailsElement).open) setOpenJson(key)
                    }}
                  >
                    <summary>{key} json</summary>
                    <pre className="selectable">{JSON.stringify(result[key], null, 2)}</pre>
                  </details>
                ) : null,
              )}
            </div>
          </div>
        ) : null}
      </section>
    </Shell>
  )
}
