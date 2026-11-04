import { useEffect, useState, type ComponentPropsWithoutRef, type ElementType, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'

export type HandleBoxProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'button' | 'label' | 'a' | typeof Link
  to?: string
} & ComponentPropsWithoutRef<'div'> &
  ComponentPropsWithoutRef<'button'> &
  ComponentPropsWithoutRef<'label'> &
  ComponentPropsWithoutRef<'a'>

export function HandleBox({
  children,
  className = '',
  as: Tag = 'div',
  ...rest
}: HandleBoxProps) {
  const Comp = Tag as ElementType
  return (
    <Comp className={`handle-box ${className}`.trim()} {...rest}>
      <i className="handle tl" />
      <i className="handle tr" />
      <i className="handle bl" />
      <i className="handle br" />
      {children}
    </Comp>
  )
}

export function GlobeIcon() {
  return (
    <svg viewBox="0 0 32 32" className="icon-lg" aria-hidden="true">
      <circle cx="16" cy="16" r="11.2" />
      <ellipse cx="16" cy="16" rx="5.2" ry="11.2" />
      <path d="M5 16h22" />
      <path d="M7.2 10.2h17.6" />
      <path d="M7.2 21.8h17.6" />
    </svg>
  )
}

export function PencilIcon() {
  return (
    <svg viewBox="0 0 32 32" className="icon-lg" aria-hidden="true">
      <path d="M20.2 7.2l4.6 4.6-12.4 12.4H7.8v-4.6L20.2 7.2z" />
      <path d="M18.4 9l4.6 4.6" />
      <path d="M8.4 24.4l3.4-.1" />
    </svg>
  )
}

export function PlaneIcon() {
  return (
    <svg viewBox="0 0 20 20" className="icon-sm" aria-hidden="true">
      <path d="M3 10.2l14-6.4-6.6 13.2-1.6-5.2L3 10.2z" />
      <path d="M8.8 11.8l5.6-4.2" />
    </svg>
  )
}

export function LogoMark() {
  return (
    <svg viewBox="0 0 22 22" className="logo-mark" aria-hidden="true">
      <rect x="8" y="1.2" width="6" height="6" rx="1.1" />
      <rect x="14.8" y="8" width="6" height="6" rx="1.1" />
      <rect x="8" y="14.8" width="6" height="6" rx="1.1" />
      <rect x="1.2" y="8" width="6" height="6" rx="1.1" />
    </svg>
  )
}

export function ShieldMark() {
  return (
    <svg viewBox="0 0 18 18" className="brand-mark" aria-hidden="true">
      <path d="M9 2.2l6.2 2.2v5.1c0 3.4-2.6 5.6-6.2 6.7C5.4 15.1 2.8 12.9 2.8 9.5V4.4L9 2.2z" />
    </svg>
  )
}

export function NodeMark() {
  return (
    <svg viewBox="0 0 18 18" className="brand-mark" aria-hidden="true">
      <circle cx="9" cy="4.2" r="1.8" />
      <circle cx="4.2" cy="13.2" r="1.8" />
      <circle cx="13.8" cy="13.2" r="1.8" />
      <path d="M8.2 5.6L5.2 11.6M9.8 5.6l3 6" />
    </svg>
  )
}

const LINKS = [
  { to: '/', label: 'Home' },
  { to: '/review', label: 'Review Lab' },
  { to: '/pipeline', label: 'Agents' },
  { to: '/guardrails', label: 'Guardrails' },
  { to: '/about', label: 'About' },
]

type ModelState = {
  isLoaded: boolean
  device?: string
  loading: boolean
}

export function Shell({ children, home = false }: { children: ReactNode; home?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [model, setModel] = useState<ModelState>({ isLoaded: false, loading: false })
  const location = useLocation()

  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  useEffect(() => {
    let cancelled = false
    fetch('/api/model/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) {
          setModel((m) => ({ ...m, isLoaded: Boolean(data.is_loaded), device: data.device }))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function loadModel() {
    setModel((m) => ({ ...m, loading: true }))
    try {
      const res = await fetch('/api/model/load', { method: 'POST' })
      const data = res.ok ? await res.json() : null
      setModel({
        isLoaded: data?.status === 'ready' || Boolean(data?.is_loaded),
        device: data?.device,
        loading: false,
      })
    } catch {
      setModel((m) => ({ ...m, loading: false }))
    }
  }

  return (
    <div className={`stage ${home ? 'is-home' : 'is-page'}`}>
      <div className="grain" />
      <main className="shell">
        <header className="topbar">
          <button
            className={`menu ${menuOpen ? 'is-open' : ''}`}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
            <span />
            <span />
            <span />
          </button>
          <NavLink className="brand" to="/" end aria-label="RedTeamer home">
            <LogoMark />
            <span>RedTeamer</span>
          </NavLink>
          <div className="top-actions">
            <button
              className={`model-pill ${model.isLoaded ? 'is-ready' : ''}`}
              type="button"
              onClick={loadModel}
              disabled={model.loading || model.isLoaded}
            >
              <i />
              {model.loading
                ? 'Loading model…'
                : model.isLoaded
                  ? model.device
                    ? `Ready · ${model.device}`
                    : 'Model Ready'
                  : 'Load Model'}
            </button>
            <NavLink className="call-us" to="/review">
              Open Lab
              <PlaneIcon />
            </NavLink>
          </div>
        </header>

        {menuOpen ? (
          <nav className="nav-overlay" aria-label="Primary">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} className="nav-item" end={link.to === '/'}>
                {link.label}
              </NavLink>
            ))}
          </nav>
        ) : null}

        {children}

        <footer className="dock">
          <HandleBox className="dock-btn globe" as={Link} to="/" aria-label="Home">
            <GlobeIcon />
          </HandleBox>

          <HandleBox className="dock-btn partners" as={Link} to="/pipeline">
            <span className="partner">
              <NodeMark />
              Attacker
            </span>
            <span className="partner">
              <ShieldMark />
              Critic
            </span>
          </HandleBox>

          <HandleBox
            className={`dock-btn subscribe ${subscribed ? 'is-on' : ''}`}
            as="label"
          >
            <input
              type="checkbox"
              checked={subscribed}
              onChange={(e) => setSubscribed(e.target.checked)}
            />
            <span className="box" aria-hidden="true" />
            Brief me on new adapters
          </HandleBox>

          <HandleBox className="dock-btn download" as={Link} to="/review">
            <span>Review Code</span>
            <HandleBox className="os-group">
              <span className="os-label">Lab</span>
            </HandleBox>
          </HandleBox>

          <HandleBox className="dock-btn edit" as={Link} to="/about" aria-label="About">
            <PencilIcon />
          </HandleBox>
        </footer>
      </main>
    </div>
  )
}
