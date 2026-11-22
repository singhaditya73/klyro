import { useState, useEffect, useRef, useCallback } from 'react'
import { Keyboard, RotateCcw, X, AlertCircle, CheckCircle2 } from 'lucide-react'

interface HotkeyRecorderProps {
  label: string
  description?: string
  value: string
  defaultValue: string
  isRegistered?: boolean
  onChange: (accelerator: string) => void
}

function parseAcceleratorKeys(accelerator: string): string[] {
  if (!accelerator || !accelerator.trim()) return []
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

  return accelerator.split('+').map((part) => {
    const raw = part.trim()
    if (raw === 'CommandOrControl' || raw === 'CmdOrCtrl') return isMac ? '⌘ Cmd' : 'Ctrl'
    if (raw === 'Control' || raw === 'Ctrl') return 'Ctrl'
    if (raw === 'Command' || raw === 'Cmd') return '⌘ Cmd'
    if (raw === 'Alt' || raw === 'Option') return isMac ? '⌥ Option' : 'Alt'
    if (raw === 'Shift') return 'Shift'
    if (raw === 'Space') return 'Space'
    return raw.length === 1 ? raw.toUpperCase() : raw
  })
}

function keyEventToAccelerator(e: KeyboardEvent): string | null {
  // Ignore bare modifier keydown events
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
    return null
  }

  // Escape cancels recording
  if (e.key === 'Escape') {
    return '__CANCEL__'
  }

  const parts: string[] = []

  // Check modifiers
  if (e.metaKey || e.ctrlKey) {
    parts.push('CommandOrControl')
  }
  if (e.altKey) {
    parts.push('Alt')
  }
  if (e.shiftKey) {
    parts.push('Shift')
  }

  // Key normalization
  let key = ''
  if (e.code === 'Space' || e.key === ' ') {
    key = 'Space'
  } else if (e.code.startsWith('Key')) {
    key = e.code.replace('Key', '').toUpperCase()
  } else if (e.code.startsWith('Digit')) {
    key = e.code.replace('Digit', '')
  } else if (e.code.startsWith('Numpad')) {
    key = e.code.replace('Numpad', 'Num')
  } else if (/^F\d{1,2}$/i.test(e.key)) {
    key = e.key.toUpperCase()
  } else if (e.code === 'Enter' || e.key === 'Enter') {
    key = 'Return'
  } else if (e.code === 'Backspace' || e.key === 'Backspace') {
    key = 'Backspace'
  } else if (e.code === 'Tab' || e.key === 'Tab') {
    key = 'Tab'
  } else if (e.code === 'ArrowUp') {
    key = 'Up'
  } else if (e.code === 'ArrowDown') {
    key = 'Down'
  } else if (e.code === 'ArrowLeft') {
    key = 'Left'
  } else if (e.code === 'ArrowRight') {
    key = 'Right'
  } else if (e.key.length === 1) {
    key = e.key.toUpperCase()
  } else {
    key = e.key
  }

  // If no modifier is pressed and it's not a functional key like F1-F12, require at least one modifier
  const isFunctionKey = /^F\d{1,2}$/i.test(key)
  if (parts.length === 0 && !isFunctionKey) {
    // Require modifier for general typing safety
    return null
  }

  parts.push(key)
  return parts.join('+')
}

export function HotkeyRecorder({
  label,
  description,
  value,
  defaultValue,
  isRegistered = true,
  onChange
}: HotkeyRecorderProps): React.JSX.Element {
  const [isRecording, setIsRecording] = useState(false)
  const [activeModifiers, setActiveModifiers] = useState<string[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  const keys = parseAcceleratorKeys(value)
  const isCustom = value.trim() !== defaultValue.trim()

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return

      e.preventDefault()
      e.stopPropagation()

      // Track active modifiers live during recording
      const mods: string[] = []
      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
      if (e.metaKey || e.ctrlKey) mods.push(isMac ? '⌘ Cmd' : 'Ctrl')
      if (e.altKey) mods.push(isMac ? '⌥ Option' : 'Alt')
      if (e.shiftKey) mods.push('Shift')
      setActiveModifiers(mods)

      const accelerator = keyEventToAccelerator(e)
      if (accelerator === '__CANCEL__') {
        setIsRecording(false)
        setActiveModifiers([])
        return
      }

      if (accelerator) {
        onChange(accelerator)
        setIsRecording(false)
        setActiveModifiers([])
      }
    },
    [isRecording, onChange]
  )

  const handleKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!isRecording) return
      const mods: string[] = []
      const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
      if (e.metaKey || e.ctrlKey) mods.push(isMac ? '⌘ Cmd' : 'Ctrl')
      if (e.altKey) mods.push(isMac ? '⌥ Option' : 'Alt')
      if (e.shiftKey) mods.push('Shift')
      setActiveModifiers(mods)
    },
    [isRecording]
  )

  useEffect(() => {
    if (!isRecording) return

    const onDocKeyDown = (e: KeyboardEvent): void => handleKeyDown(e)
    const onDocKeyUp = (e: KeyboardEvent): void => handleKeyUp(e)
    const onDocClick = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsRecording(false)
        setActiveModifiers([])
      }
    }

    window.addEventListener('keydown', onDocKeyDown, { capture: true })
    window.addEventListener('keyup', onDocKeyUp, { capture: true })
    window.addEventListener('mousedown', onDocClick)

    return () => {
      window.removeEventListener('keydown', onDocKeyDown, { capture: true })
      window.removeEventListener('keyup', onDocKeyUp, { capture: true })
      window.removeEventListener('mousedown', onDocClick)
    }
  }, [isRecording, handleKeyDown, handleKeyUp])

  return (
    <div
      ref={containerRef}
      className={`hotkey-card ${isRecording ? 'hotkey-card--recording' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '14px 16px',
        background: isRecording ? 'rgba(249, 115, 22, 0.05)' : 'rgba(255, 255, 255, 0.02)',
        border: isRecording ? '1px solid var(--accent, #f97316)' : '1px solid rgba(255, 255, 255, 0.07)',
        borderRadius: 8,
        transition: 'all 0.15s ease'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #ffffff)' }}>{label}</span>
            {value ? (
              isRegistered ? (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 9999,
                    background: 'rgba(34, 197, 94, 0.12)',
                    color: '#4ade80',
                    border: '1px solid rgba(34, 197, 94, 0.25)'
                  }}
                >
                  <CheckCircle2 style={{ width: 10, height: 10 }} /> Active
                </span>
              ) : (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 9999,
                    background: 'rgba(239, 68, 68, 0.12)',
                    color: '#f87171',
                    border: '1px solid rgba(239, 68, 68, 0.25)'
                  }}
                  title="This shortcut could not be registered by the system. Another running application or your window manager might be using it."
                >
                  <AlertCircle style={{ width: 10, height: 10 }} /> Conflict / Taken
                </span>
              )
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 9999,
                  background: 'rgba(255, 255, 255, 0.05)',
                  color: 'var(--text-muted, #888888)',
                  border: '1px solid rgba(255, 255, 255, 0.1)'
                }}
              >
                Disabled
              </span>
            )}
          </div>
          {description && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted, #888888)', lineHeight: 1.4 }}>
              {description}
            </p>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isCustom && (
            <button
              type="button"
              className="btn btn--quiet btn--xs"
              onClick={() => onChange(defaultValue)}
              title={`Reset to default (${defaultValue})`}
              style={{ padding: '4px 8px', fontSize: 11 }}
            >
              <RotateCcw style={{ width: 12, height: 12, marginRight: 4 }} />
              Reset
            </button>
          )}
          {value && (
            <button
              type="button"
              className="btn btn--quiet btn--xs"
              onClick={() => onChange('')}
              title="Disable shortcut"
              style={{ padding: '4px 6px', color: 'var(--text-muted, #888888)' }}
            >
              <X style={{ width: 12, height: 12 }} />
            </button>
          )}
        </div>
      </div>

      {/* Keystroke Display & Recorder Target */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 2 }}>
        <button
          type="button"
          onClick={() => setIsRecording(true)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 34,
            padding: '4px 10px',
            background: isRecording ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.25)',
            border: isRecording ? '1px dashed var(--accent, #f97316)' : '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            cursor: 'pointer',
            outline: 'none',
            textAlign: 'left'
          }}
        >
          {isRecording ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: 'var(--accent, #f97316)',
                  animation: 'pulse 1.2s infinite'
                }}
              />
              <span style={{ fontSize: 12, color: 'var(--accent, #f97316)', fontWeight: 550 }}>
                {activeModifiers.length > 0 ? (
                  <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    {activeModifiers.map((mod) => (
                      <kbd key={mod} className="kbd" style={{ fontSize: 10, padding: '1px 5px' }}>{mod}</kbd>
                    ))}
                    <span>+ press key...</span>
                  </span>
                ) : (
                  'Press hotkey combination... (Esc to cancel)'
                )}
              </span>
            </div>
          ) : keys.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {keys.map((k, idx) => (
                <kbd key={`${k}-${idx}`} className="kbd" style={{ fontSize: 11, padding: '2px 7px' }}>
                  {k}
                </kbd>
              ))}
              <span style={{ fontSize: 11, color: 'var(--text-muted, #777)', marginLeft: 6 }}>
                (Click to change)
              </span>
            </div>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--text-muted, #777)' }}>
              No shortcut set — click to assign
            </span>
          )}
        </button>

        {!isRecording && (
          <button
            type="button"
            className="btn btn--quiet btn--xs"
            onClick={() => setIsRecording(true)}
            style={{ fontSize: 11, padding: '4px 9px', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <Keyboard style={{ width: 12, height: 12 }} />
            {value ? 'Rebind' : 'Record'}
          </button>
        )}
      </div>
    </div>
  )
}

