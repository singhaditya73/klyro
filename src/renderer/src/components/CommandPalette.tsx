import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Brain,
  Clock,
  CornerDownLeft,
  Cpu,
  House,
  Keyboard,
  Moon,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sun,
  Zap
} from 'lucide-react'
import type { Route } from '../hooks/useHashRoute'

/**
 * The command palette.
 *
 * One keyboard surface for every destination and every global action. It
 * follows the conventions a desktop user already has: grouped, counted
 * results, a highlighted active row, a footer that names the keys, and an
 * honest empty state. Nothing here is decorative — each row runs something
 * that exists.
 */

export interface PaletteCommand {
  id: string
  label: string
  description?: string
  group: string
  icon: typeof House
  hint?: string
  keywords?: string
  run: () => void | Promise<void>
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onNavigate: (route: Route) => void
  onOpenOverlay: () => void
  onToggleTheme: () => void
  onCheckForUpdates: () => void
}

const ROUTE_COMMANDS: Array<{ route: Route; label: string; description: string; icon: typeof House; hint: string }> = [
  { route: 'home', label: 'Home', description: 'Status, providers and recent activity', icon: House, hint: 'Alt+1' },
  { route: 'models', label: 'Models & Agents', description: 'Providers, keys and the active model', icon: Cpu, hint: 'Alt+2' },
  { route: 'knowledge', label: 'Knowledge', description: 'Memories and indexed documents', icon: Brain, hint: 'Alt+3' },
  { route: 'interviews', label: 'Meetings & Interviews', description: 'Recordings, transcripts and notes', icon: Clock, hint: 'Alt+4' },
  { route: 'integrations', label: 'Integrations & MCP', description: 'Calendar, webhooks and MCP servers', icon: Blocks, hint: 'Alt+5' },
  { route: 'settings', label: 'Settings', description: 'Assistant, desktop and retention', icon: Settings, hint: 'Alt+6' },
  { route: 'privacy', label: 'Privacy & Data', description: 'What is stored and what leaves this machine', icon: ShieldCheck, hint: 'Alt+7' }
]

/** A subsequence match: "mdl" finds "Models & Agents". Prefix hits rank first. */
function matches(label: string, query: string): { hit: boolean; rank: number } {
  const target = label.toLowerCase()
  const needle = query.toLowerCase()
  if (!needle) return { hit: true, rank: 0 }
  if (target.startsWith(needle)) return { hit: true, rank: 0 }
  const direct = target.indexOf(needle)
  if (direct >= 0) return { hit: true, rank: 1 + direct }
  let index = 0
  for (const char of needle) {
    index = target.indexOf(char, index)
    if (index === -1) return { hit: false, rank: 0 }
    index += 1
  }
  return { hit: true, rank: 100 }
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onOpenOverlay,
  onToggleTheme,
  onCheckForUpdates
}: CommandPaletteProps): React.ReactNode {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<Element | null>(null)

  const commands = useMemo<PaletteCommand[]>(
    () => [
      {
        id: 'quick-ask',
        label: 'Open quick ask',
        description: 'The floating overlay, wherever you are',
        group: 'Actions',
        icon: Zap,
        hint: 'Global shortcut',
        keywords: 'overlay hud ask',
        run: onOpenOverlay
      },
      {
        id: 'toggle-theme',
        label: 'Switch theme',
        description: 'Cycle system, dark and light',
        group: 'Actions',
        icon: Moon,
        keywords: 'appearance dark light',
        run: onToggleTheme
      },
      {
        id: 'check-updates',
        label: 'Check for updates',
        description: 'Ask the release page once',
        group: 'Actions',
        icon: RefreshCw,
        keywords: 'version upgrade',
        run: onCheckForUpdates
      },
      ...ROUTE_COMMANDS.map((item) => ({
        id: `go-${item.route}`,
        label: item.label,
        description: item.description,
        group: 'Go to',
        icon: item.icon,
        hint: item.hint,
        keywords: item.route,
        run: () => onNavigate(item.route)
      }))
    ],
    [onCheckForUpdates, onNavigate, onOpenOverlay, onToggleTheme]
  )

  const results = useMemo(() => {
    return commands
      .map((command) => {
        const byLabel = matches(command.label, query)
        const byKeyword = command.keywords ? matches(command.keywords, query) : { hit: false, rank: 200 }
        return { command, rank: Math.min(byLabel.rank, byKeyword.rank) }
      })
      .filter((entry) => entry.rank < 200)
      .sort((a, b) => a.rank - b.rank)
      .map((entry) => entry.command)
  }, [commands, query])

  const groups = useMemo(() => {
    const order = ['Actions', 'Go to']
    const map = new Map<string, PaletteCommand[]>()
    for (const command of results) {
      const list = map.get(command.group) ?? []
      list.push(command)
      map.set(command.group, list)
    }
    return order.filter((name) => map.has(name)).map((name) => ({ name, items: map.get(name) ?? [] }))
  }, [results])

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement
    setQuery('')
    setActive(0)
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus())
    return () => {
      window.cancelAnimationFrame(frame)
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus()
    }
  }, [open])

  useEffect(() => {
    setActive(0)
  }, [query])

  // Keep the active row visible without animating the whole list.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [active, results])

  const runActive = useCallback(
    (index: number): void => {
      const command = results[index]
      if (!command) return
      onClose()
      void command.run()
    },
    [onClose, results]
  )

  if (!open) return null

  let flatIndex = -1
  return (
    <div
      className="cmdk-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="cmdk" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="cmdk__search">
          <Search className="icon icon--sm cmdk__search-icon" aria-hidden="true" />
          <input
            ref={inputRef}
            className="cmdk__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((current) => (results.length === 0 ? 0 : (current + 1) % results.length))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((current) => (results.length === 0 ? 0 : (current - 1 + results.length) % results.length))
              } else if (event.key === 'Home') {
                event.preventDefault()
                setActive(0)
              } else if (event.key === 'End') {
                event.preventDefault()
                setActive(Math.max(0, results.length - 1))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                runActive(active)
              }
            }}
            placeholder="Search or run a command"
            aria-label="Search commands"
            aria-controls="cmdk-results"
            aria-activedescendant={results[active] ? `cmdk-${results[active].id}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd className="kbd cmdk__esc">Esc</kbd>
        </div>

        <div className="cmdk__list" id="cmdk-results" role="listbox" ref={listRef}>
          {results.length === 0 && (
            <div className="cmdk__empty">
              <div className="cmdk__empty-title">Nothing matches “{query}”</div>
              <div className="cmdk__empty-text">Try a section name, or press Esc and use the sidebar.</div>
            </div>
          )}
          {groups.map((group) => (
            <div className="cmdk__group" key={group.name} role="group" aria-label={group.name}>
              <div className="cmdk__group-label">
                <span>{group.name}</span>
                <span className="cmdk__group-count">{group.items.length}</span>
              </div>
              {group.items.map((command) => {
                flatIndex += 1
                const index = flatIndex
                const Icon = command.icon
                const isActive = index === active
                return (
                  <button
                    key={command.id}
                    id={`cmdk-${command.id}`}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    data-active={isActive}
                    className={`cmdk__item${isActive ? ' cmdk__item--active' : ''}`}
                    onMouseMove={() => setActive(index)}
                    onClick={() => runActive(index)}
                  >
                    <Icon className="icon icon--sm cmdk__icon" aria-hidden="true" />
                    <span className="cmdk__text">
                      <span className="cmdk__label">{command.label}</span>
                      {command.description && <span className="cmdk__desc">{command.description}</span>}
                    </span>
                    {command.hint && <kbd className="kbd cmdk__hint">{command.hint}</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="cmdk__footer">
          <span className="cmdk__footer-group">
            <kbd className="kbd">
              <ArrowUp className="icon" style={{ width: 10, height: 10 }} aria-hidden="true" />
            </kbd>
            <kbd className="kbd">
              <ArrowDown className="icon" style={{ width: 10, height: 10 }} aria-hidden="true" />
            </kbd>
            <span>Navigate</span>
          </span>
          <span className="cmdk__footer-group">
            <kbd className="kbd">
              <CornerDownLeft className="icon" style={{ width: 10, height: 10 }} aria-hidden="true" />
            </kbd>
            <span>Run</span>
          </span>
          <span className="cmdk__footer-spacer" />
          <span className="cmdk__footer-group">
            <Keyboard className="icon icon--xs" aria-hidden="true" />
            <span>Ctrl / ⌘ K</span>
          </span>
          <span className="cmdk__footer-group">
            <Sun className="icon icon--xs" aria-hidden="true" />
            <span>{results.length} results</span>
          </span>
        </div>
      </div>
    </div>
  )
}
