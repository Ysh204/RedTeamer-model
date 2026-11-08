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
  const [model, setModel] = useState<ModelState>({ isLoaded: false, loading: false })
  const location = useLocation()
  const [prevPath, setPrevPath] = useState(location.pathname)

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMenuOpen(false)
  }

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
          <nav className="dock-nav" aria-label="Sections">
            {LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === '/'}>
                {link.label}
              </NavLink>
            ))}
          </nav>
          <p className="dock-note">Read-only · never writes to disk</p>
        </footer>
      </main>
    </div>
  )
}
