import { Shell } from '../chrome'

const AGENTS = [
  {
    stage: '01',
    name: 'Attacker',
    adapter: 'security-redteamer-qwen3-lora-v5 · r=8',
    role: 'Static analysis on untrusted Python. Names the CWE, severity, and the exact vulnerable line.',
    statuses: ['finding', 'no_finding', 'needs_more_context'],
    halt: 'If no_finding, the pipeline stops. No critic. No patch.',
  },
  {
    stage: '02',
    name: 'Critic',
    adapter: 'critic_v1 · r=16',
    role: 'Adversarial auditor. Rejects ungrounded quotes, existing sanitizers, and safe containment.',
    statuses: ['confirmed', 'rejected', 'needs_more_context'],
    halt: 'The patcher unlocks only on confirmed + evidence_grounded.',
  },
  {
    stage: '03',
    name: 'Patcher',
    adapter: 'patcher_v31 · r=32',
    role: 'Minimal old/new replacements, then AST, scope, apply-check, and a ≤60 line diff gate.',
    statuses: ['patch_proposed', 'no_patch'],
    halt: 'Applied is always false. A human still has to approve.',
  },
]

export function PipelinePage() {
  return (
    <Shell>
      <section className="panel">
        <div className="panel-head">
          <p className="eyebrow">
            <span className="diamonds" aria-hidden="true">
              <i />
              <i />
            </span>
            THREE SPECIALISTS · ONE BASE MODEL
          </p>
          <h1>
            <span className="line">Attacker, critic,</span>
            <span className="line">
              <em>then</em> a patcher.
            </span>
          </h1>
          <p className="lede selectable">
            Qwen/Qwen3-4B stays in memory. LoRA adapters swap per stage so the same 4-bit weights
            can hunt, doubt, and rewrite without leaving the GPU.
          </p>
        </div>

        <ol className="agent-list">
          {AGENTS.map((agent) => (
            <li key={agent.name} className="agent-card handle-box">
              <i className="handle tl" />
              <i className="handle tr" />
              <i className="handle bl" />
              <i className="handle br" />
              <span className="agent-stage">{agent.stage}</span>
              <div>
                <h2>{agent.name}</h2>
                <p className="mono">{agent.adapter}</p>
                <p>{agent.role}</p>
                <ul className="status-pills">
                  {agent.statuses.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <p className="halt">{agent.halt}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </Shell>
  )
}
