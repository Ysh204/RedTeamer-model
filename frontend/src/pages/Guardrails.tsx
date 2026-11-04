import { Shell } from '../chrome'

const CHECKS = [
  {
    title: 'Read-only by contract',
    body: 'RedTeamer never writes or applies changes to disk. It returns a unified diff and patched preview for a person to accept or throw away.',
  },
  {
    title: 'Python AST parse',
    body: 'Every proposed edit must still parse. If ast.parse fails, the patch is rejected before it reaches the UI.',
  },
  {
    title: 'Scope analysis',
    body: 'New names cannot appear undefined. The patcher is not allowed to invent helpers that are not already in the snippet.',
  },
  {
    title: 'Simulated git apply',
    body: 'The unified diff is checked as if git apply --check ran. A non-applicable hunk never displays as a proposal.',
  },
  {
    title: 'Small change only',
    body: 'Diffs over 60 lines are refused. The point is a surgical replacement, not a rewrite of the file.',
  },
  {
    title: 'Evidence must exist',
    body: 'The attacker’s quoted line has to appear in the submitted source. Ungrounded findings die at the critic gate.',
  },
]

export function GuardrailsPage() {
  return (
    <Shell>
      <section className="panel">
        <div className="panel-head">
          <p className="eyebrow">
            <span className="diamonds" aria-hidden="true">
              <i />
              <i />
            </span>
            DETERMINISTIC CHECKS AFTER THE MODEL
          </p>
          <h1>
            <span className="line">The model suggests.</span>
            <span className="line">
              <em>The AST</em> decides.
            </span>
          </h1>
          <p className="lede selectable">
            Input is a single Python snippet, 6,000 characters at most. Output is a suggestion.
            Human approval is required. <code>applied</code> stays false.
          </p>
        </div>

        <div className="guard-grid">
          {CHECKS.map((item) => (
            <article key={item.title} className="handle-box guard-card">
              <i className="handle tl" />
              <i className="handle tr" />
              <i className="handle bl" />
              <i className="handle br" />
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  )
}
