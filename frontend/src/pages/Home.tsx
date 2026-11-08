import { useEffect, useState } from 'react'
import { BurningCpu } from '../BurningCpu'
import { TopoMap } from '../TopoMap'
import { Shell } from '../chrome'

const LINE1 = 'Re:think & Ke:p'
const YOUR = 'YOUR'
const REST = ' Code Honest'
const SMILE = '):('
const TOTAL = LINE1.length + YOUR.length + REST.length + SMILE.length

function take(source: string, remaining: number): [string, number] {
  const slice = source.slice(0, Math.max(0, remaining))
  return [slice, remaining - slice.length]
}

export function HomePage() {
  const [typed, setTyped] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return TOTAL
    }
    return 0
  })

  useEffect(() => {
    if (typed >= TOTAL) {
      return
    }
    let n = typed
    let id = 0
    const delay = window.setTimeout(() => {
      id = window.setInterval(() => {
        n += 1
        setTyped(n)
        if (n >= TOTAL) window.clearInterval(id)
      }, 28)
    }, 220)
    return () => {
      window.clearTimeout(delay)
      window.clearInterval(id)
    }
  }, [typed])

  let remaining = typed
  let line1: string
  let your: string
  let rest: string
  let smile: string
  ;[line1, remaining] = take(LINE1, remaining)
  ;[your, remaining] = take(YOUR, remaining)
  ;[rest, remaining] = take(REST, remaining)
  ;[smile] = take(SMILE, remaining)

  return (
    <Shell home>
      <section className="hero" id="top">
        <div className="hero-grid" />
        <div className="hero-visual" aria-hidden="true">
          <BurningCpu />
        </div>

        <div className="hero-meta">
          <TopoMap />
          <div className="skv">
            <span>RT ©</span>
            <p>
              Read-only
              <br />
              Never writes
              <br />
              to disk
            </p>
          </div>
        </div>

        <div className="hero-copy">
          <p className="eyebrow">
            <span className="diamonds" aria-hidden="true">
              <i />
              <i />
            </span>
            ADVERSARIAL MULTI-AGENT REVIEW
          </p>
          <h1>
            <span className="line">{line1}</span>
            <span className="line">
              <em>{your}</em>
              {rest}
              {smile ? <small>{smile}</small> : null}
            </span>
          </h1>
        </div>
      </section>
    </Shell>
  )
}
