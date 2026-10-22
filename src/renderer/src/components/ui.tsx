import type { ReactNode } from 'react'
import { Loader2, type LucideIcon } from 'lucide-react'

/**
 * The small parts every surface shares.
 *
 * The app was written with plain elements and CSS classes, and that is still
 * the way it works: these components are thin wrappers that give the same
 * markup a name, so the shell, the pages and the overlay cannot drift apart.
 */

/** A page's title block: what this is, and what you can do here. */
export function PageHeader({
  title,
  description,
  actions,
  icon: Icon
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  icon?: LucideIcon
}): ReactNode {
  return (
    <header className="page-header">
      <div>
        <div className="row" style={{ gap: 8 }}>
          {Icon && <Icon className="icon icon--sm" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />}
          <h1 className="page-header__title">{title}</h1>
        </div>
        {description && <p className="page-header__desc">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}

/** A card that groups one subject: a section title, a line of explanation, a body. */
export function Group({
  title,
  description,
  icon: Icon,
  actions,
  children,
  flush,
  id
}: {
  title?: string
  description?: ReactNode
  icon?: LucideIcon
  actions?: ReactNode
  children: ReactNode
  flush?: boolean
  id?: string
}): ReactNode {
  return (
    <section className="group" id={id}>
      {(title || actions) && (
        <div className="group__head">
          {Icon && (
            <span className="icon-tile" style={{ width: 32, height: 32 }}>
              <Icon className="icon icon--sm" aria-hidden="true" />
            </span>
          )}
          <div className="group__head-text">
            {title && <div className="group__title">{title}</div>}
            {description && <div className="group__desc">{description}</div>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={flush ? 'group__body group__body--flush' : 'group__body'}>{children}</div>
    </section>
  )
}

/** A label with its explanation on the left, a control on the right. */
export function SettingRow({
  label,
  hint,
  children,
  stacked
}: {
  label: ReactNode
  hint?: ReactNode
  children?: ReactNode
  stacked?: boolean
}): ReactNode {
  return (
    <div className="setting">
      <div className="setting__text">
        <div className="setting__label">{label}</div>
        {hint && <div className="setting__hint">{hint}</div>}
      </div>
      {children && (
        <div className={stacked ? 'setting__control setting__control--stack' : 'setting__control'}>{children}</div>
      )}
    </div>
  )
}

export type StatusState = 'ok' | 'warn' | 'error' | 'idle' | 'live'

/** One dot that says how something is doing. Colour is never the only signal. */
export function StatusDot({ state, title }: { state: StatusState; title?: string }): ReactNode {
  return (
    <span
      className={`status-dot${state === 'idle' ? '' : ` status-dot--${state}`}`}
      title={title}
      aria-hidden="true"
    />
  )
}

/** A badge that carries a state in words as well as in colour. */
export function Badge({
  tone = 'neutral',
  children,
  title
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'error' | 'accent' | 'idle'
  children: ReactNode
  title?: string
}): ReactNode {
  const toneClass = tone === 'neutral' || tone === 'idle' ? '' : ` pill--${tone}`
  return (
    <span className={`pill${toneClass}`} title={title}>
      {children}
    </span>
  )
}

/** Nothing here yet — and what to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  text,
  action
}: {
  icon?: LucideIcon
  title: string
  text?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      {Icon && (
        <span className="empty__icon">
          <Icon className="icon icon--md" aria-hidden="true" />
        </span>
      )}
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action && <div className="empty__actions">{action}</div>}
    </div>
  )
}

/** Something is happening. Say what, without inventing a number. */
export function Loading({ label = 'Loading…' }: { label?: string }): ReactNode {
  return (
    <div className="loading-line" role="status">
      <Loader2 className="icon icon--sm spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

/** A keyboard shortcut, shown the way the operating system shows one. */
export function Kbd({ children }: { children: ReactNode }): ReactNode {
  return <kbd className="kbd">{children}</kbd>
}

/** A short note under a control. */
export function Hint({ children, style }: { children: ReactNode; style?: React.CSSProperties }): ReactNode {
  return (
    <div className="hint" style={style}>
      {children}
    </div>
  )
}
