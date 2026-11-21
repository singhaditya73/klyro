import React, { useState, useEffect, useRef } from 'react'
import {
  Search,
  Zap,
  Activity,
  ShieldAlert,
  Calendar,
  FileText,
  Eye,
  EyeOff,
  Target,
  Smartphone,
  Ghost,
  X,
  SlidersHorizontal,
  ExternalLink,
  Trash2
} from 'lucide-react'

export interface CommandItem {
  id: string
  label: string
  description: string
  shortcut?: string
  icon: React.ComponentType<{ className?: string }>
  active?: boolean
  badge?: string
}

export interface OverlayCommandMenuProps {
  open: boolean
  onClose: () => void
  onSelectAction: (id: string) => void
  state: {
    privateMode: boolean
    zeroFocus: boolean
    hesitationRadar: boolean
    ghostPhone: boolean
    hasAnswer: boolean
    hasHistory: boolean
    mode: 'idle' | 'recording' | 'listening'
  }
}

export function OverlayCommandMenu({
  open,
  onClose,
  onSelectAction,
  state
}: OverlayCommandMenuProps): React.ReactElement | null {
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands: CommandItem[] = [
    {
      id: 'catchup',
      label: 'Catch Me Up Briefing',
      description: 'Instant catch-up of missed context and active topic',
      shortcut: 'Alt+U',
      icon: Zap,
      badge: state.mode === 'listening' ? 'Available' : undefined
    },
    {
      id: 'radar',
      label: 'Live Hesitation & Intent Radar',
      description: 'Acoustic psychology analysis of client conviction vs friction',
      shortcut: 'Alt+H',
      icon: Activity,
      active: state.hesitationRadar,
      badge: state.hesitationRadar ? 'Active' : undefined
    },
    {
      id: 'objection',
      label: 'Objection Helper',
      description: 'Generate 2 tactical, diplomatic responses to client hesitation',
      icon: ShieldAlert,
      badge: state.mode === 'listening' ? 'Available' : undefined
    },
    {
      id: 'agenda',
      label: 'Meeting Agenda Checklist',
      description: 'Track topics discussed and outstanding meeting items',
      icon: Calendar
    },
    {
      id: 'notes',
      label: 'Live Private Notes',
      description: 'Jot notes live that merge directly into the CRM recap',
      icon: FileText
    },
    {
      id: 'private',
      label: state.privateMode ? 'Disable Stealth Mode' : 'Enable Stealth Mode',
      description: 'Keep overlay strictly invisible to screen shares & screenshots',
      icon: state.privateMode ? EyeOff : Eye,
      active: state.privateMode,
      badge: state.privateMode ? 'Stealth ON' : undefined
    },
    {
      id: 'zerofocus',
      label: state.zeroFocus ? 'Disable Zero-Focus Mode' : 'Enable Zero-Focus Mode',
      description: 'Never steal window focus (HackerRank & proctor safe)',
      shortcut: 'Alt+Z',
      icon: Target,
      active: state.zeroFocus,
      badge: state.zeroFocus ? 'Active' : undefined
    },
    {
      id: 'ghostphone',
      label: 'Ghost Phone (Remote Mirror)',
      description: 'Mirror cues and answers to your phone with 0 screen presence',
      icon: Smartphone,
      active: state.ghostPhone,
      badge: state.ghostPhone ? 'Connected' : undefined
    },
    {
      id: 'decoy',
      label: 'Decoy Notepad Camouflage',
      description: 'Instantly disguise overlay as a standard Windows Notepad',
      shortcut: 'Alt+D',
      icon: Ghost
    },
    {
      id: 'rsvp',
      label: 'Eye-Gaze RSVP Flasher',
      description: 'Read answers rapidly at a single gaze focal point',
      shortcut: 'Alt+R',
      icon: Zap,
      badge: state.hasAnswer ? 'Ready' : undefined
    },
    {
      id: 'prompter',
      label: 'Snap to Top Notch / Prompter',
      description: 'Reposition overlay right under your webcam for natural eye contact',
      shortcut: 'Alt+P',
      icon: SlidersHorizontal
    },
    {
      id: 'clear',
      label: 'Clear Thread History',
      description: 'Reset conversation turns and start with a clean HUD slate',
      icon: Trash2,
      badge: state.hasHistory ? 'Active Thread' : undefined
    },
    {
      id: 'panel',
      label: 'Open Full Control Panel',
      description: 'Manage models, API keys, integrations and saved transcripts',
      icon: ExternalLink
    }
  ]

  const filtered = commands.filter(
    (c) =>
      c.label.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase()) ||
      (c.shortcut && c.shortcut.toLowerCase().includes(search.toLowerCase()))
  )

  useEffect(() => {
    if (open) {
      setSearch('')
      setSelectedIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [search])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((prev) =>
          filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
        )
      } else if (e.key === 'Enter') {
        if (filtered[selectedIndex]) {
          e.preventDefault()
          onSelectAction(filtered[selectedIndex].id)
          onClose()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, filtered, selectedIndex, onClose, onSelectAction])

  if (!open) return null

  return (
    <div className="overlay__command-backdrop" onClick={onClose}>
      <div
        className="overlay__command-palette"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Quick Actions &amp; Tools"
      >
        <div className="overlay__command-search">
          <Search className="icon icon--sm" style={{ color: 'var(--text-muted)' }} />
          <input
            ref={inputRef}
            type="text"
            className="overlay__command-input"
            placeholder="Type a command or shortcut (Alt+U, Alt+H, Alt+D)…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="btn btn--icon btn--xs btn--quiet"
            onClick={onClose}
            aria-label="Close command palette"
          >
            <X className="icon icon--xs" />
          </button>
        </div>

        <div className="overlay__command-list" role="listbox">
          {filtered.length === 0 ? (
            <div className="overlay__command-empty">No matching actions found</div>
          ) : (
            filtered.map((item, index) => {
              const Icon = item.icon
              const isSelected = index === selectedIndex
              return (
                <div
                  key={item.id}
                  className={`overlay__command-item ${isSelected ? 'overlay__command-item--selected' : ''}`}
                  onClick={() => {
                    onSelectAction(item.id)
                    onClose()
                  }}
                  onMouseEnter={() => setSelectedIndex(index)}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className="overlay__command-item-main">
                    <span
                      className={`overlay__command-icon ${item.active ? 'overlay__command-icon--active' : ''}`}
                    >
                      <Icon className="icon icon--sm" />
                    </span>
                    <div className="overlay__command-info">
                      <div className="overlay__command-label">{item.label}</div>
                      <div className="overlay__command-desc">{item.description}</div>
                    </div>
                  </div>
                  <div className="overlay__command-meta">
                    {item.badge && (
                      <span
                        className={`overlay__command-badge ${item.active ? 'overlay__command-badge--active' : ''}`}
                      >
                        {item.badge}
                      </span>
                    )}
                    {item.shortcut && (
                      <kbd className="overlay__command-kbd">{item.shortcut}</kbd>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>

        <footer className="overlay__command-footer">
          <span>Navigate with <kbd>↑</kbd> <kbd>↓</kbd></span>
          <span>Select with <kbd>Enter</kbd></span>
          <span>Close with <kbd>Esc</kbd></span>
        </footer>
      </div>
    </div>
  )
}
