import { Shell } from '../chrome'

export function AboutPage() {
  return (
    <Shell>
      <section className="panel">
        <div className="panel-head">
          <p className="eyebrow">
            <span className="diamonds" aria-hidden="true">
              <i />
              <i />
            </span>
            EXPERIMENTAL REVIEW AID
          </p>
          <h1>
            <span className="line">RedTeamer is a</span>
            <span className="line">
              <em>defensive</em> prototype.
            </span>
          </h1>
          <p className="lede selectable">
            It reviews Python snippets with three sequential specialists sharing one quantized
            Qwen3-4B backbone. All proposals require human review. Nothing is executed against
            untrusted input. Nothing is written back to your tree.
          </p>
        </div>

        <div className="about-stack">
          <article className="handle-box about-card">
            <i className="handle tl" />
            <i className="handle tr" />
            <i className="handle bl" />
            <i className="handle br" />
            <h2>What it is for</h2>
            <p>
              Catching a short list of high-signal weaknesses in small Python: injection, path
              confusion, hardcoded secrets, unsafe deserialization. It is a triage aid, not a
              scanner that claims coverage of a repository.
            </p>
          </article>
          <article className="handle-box about-card">
            <i className="handle tl" />
            <i className="handle tr" />
            <i className="handle bl" />
            <i className="handle br" />
            <h2>What it will not do</h2>
            <p>
              It will not run your code, call production APIs, or apply the diff. Failed
              programmatic checks hide the patch. False positives are expected; the critic exists
              because the attacker is biased toward finding something.
            </p>
          </article>
          <aside className="disclaimer selectable">
            Experimental review aid. All proposals require human review. Do not treat a confirmed
            finding as proof of exploitability, and do not merge a patch you have not read.
          </aside>
        </div>
      </section>
    </Shell>
  )
}
