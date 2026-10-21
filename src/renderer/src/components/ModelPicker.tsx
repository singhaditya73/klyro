import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, RefreshCcw, Search } from 'lucide-react'

/**
 * Pick a model, for any provider.
 *
 * Every provider is asked what it has — the local agents (Antigravity,
 * OpenCode, Ollama), the hosted ones (OpenAI, Anthropic, Gemini, Groq) and
 * the agent CLIs. The user picks from the list; a model that is not listed can
 * still be typed in, because a provider may serve a model it does not
 * advertise.
 *
 * The list is rendered in a portal, because the pickers live inside panels
 * that clip their overflow.
 */

export interface PickerModel {
  id: string
  name: string
  provider: string
  quota: number | null
  free: boolean
}

interface Props {
  /** The provider whose models are listed. */
  providerId: string
  /** The model currently in use. */
  value: string
  onChange: (modelId: string) => void
  /** Where the picker is used — it changes the compactness. */
  variant?: 'field' | 'chip'
  /** What to call the provider in the empty list. */
  providerLabel?: string
  /** Called when the list is refreshed. */
  onRefresh?: () => void
}

interface Placement {
  top: number
  left: number
  width: number
  /** True when the list had to open upwards to stay on screen. */
  above: boolean
}

export function ModelPicker({
  providerId,
  value,
  onChange,
  variant = 'field',
  providerLabel,
  onRefresh
}: Props) {
  const [models, setModels] = useState<PickerModel[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  /** The provider the list currently belongs to, so a stale answer is dropped. */
  const providerRef = useRef(providerId)

  providerRef.current = providerId

  const load = useCallback(async (): Promise<void> => {
    const requested = providerId
    setLoading(true)
    try {
      const result = await window.klyro.providerModels(requested)
      // The provider may have changed while the answer was on its way: a
      // late answer for the old provider must not replace the new list.
      if (providerRef.current !== requested) return
      setModels(result.models ?? [])
      setNote(result.note ?? null)
      onRefresh?.()
    } catch {
      if (providerRef.current !== requested) return
      setModels([])
      setNote('Could not ask the provider for its models.')
    } finally {
      if (providerRef.current === requested) setLoading(false)
    }
  }, [providerId, onRefresh])

  // Ask the provider what it has, and again whenever the provider changes.
  useEffect(() => {
    void load()
  }, [load])

  // Place the list next to the control, flipping up when there is no room.
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const below = window.innerHeight - rect.bottom
    const above = rect.top
    const flip = below < 260 && above > below
    setPlacement({
      top: flip ? Math.max(8, rect.top - 8) : rect.bottom + 6,
      left: Math.min(Math.max(8, rect.left), window.innerWidth - 300),
      width: Math.max(240, rect.width),
      above: flip
    })
  }, [open, models])

  // Close when the click lands outside the picker.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.('.model-picker__menu')) return
      setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const filtered = useMemo(() => {
    const list = models ?? []
    const needle = query.trim().toLowerCase()
    if (!needle) return list
    return list.filter(
      (entry) =>
        entry.id.toLowerCase().includes(needle) ||
        entry.name.toLowerCase().includes(needle) ||
        entry.provider.toLowerCase().includes(needle)
    )
  }, [models, query])

  const selected = (models ?? []).find((entry) => entry.id === value)
  const label = selected?.name || value || 'Pick a model'

  const menu = open ? (
    <ModelList
      providerId={providerId}
      models={filtered}
      loading={loading}
      query={query}
      onQuery={setQuery}
      value={value}
      onPick={(id) => {
        onChange(id)
        setOpen(false)
      }}
      onReload={() => void load()}
      onCustom={() => {
        setCustom(true)
        setOpen(false)
      }}
      providerLabel={providerLabel}
      note={note}
      hasQuery={query.trim().length > 0}
      placement={placement}
    />
  ) : null

  if (variant === 'chip') {
    return (
      <div className="model-picker model-picker--chip" data-provider={providerId}>
        <button
          type="button"
          ref={triggerRef}
          className="model-picker__chip"
          onClick={() => setOpen((previous) => !previous)}
          title={`Model: ${value || 'not set'}`}
        >
          <span className="model-picker__chip-label">{label}</span>
          <ChevronDown className="icon icon--xs" aria-hidden="true" />
        </button>
        {custom && (
          <div className="model-picker__custom">
            <input
              className="field"
              value={value}
              autoFocus
              placeholder="Type a model id"
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'Escape') setCustom(false)
              }}
            />
            <button className="btn btn--ghost btn--sm" onClick={() => setCustom(false)}>
              Done
            </button>
          </div>
        )}
        {menu}
      </div>
    )
  }

  return (
    <div className="model-picker" data-provider={providerId}>
      <div className="model-picker__control">
        <button
          type="button"
          ref={triggerRef}
          className="model-picker__button"
          onClick={() => setOpen((previous) => !previous)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={value ? '' : 'muted'}>{label}</span>
          <ChevronDown className="icon icon--xs" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn btn--icon btn--ghost"
          onClick={() => void load()}
          disabled={loading}
          title="Ask the provider for its models"
          aria-label="Detect models"
        >
          {loading ? (
            <Loader2 className="icon icon--xs spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="icon icon--xs" aria-hidden="true" />
          )}
        </button>
      </div>
      {custom && (
        <input
          className="field"
          value={value}
          autoFocus
          placeholder="Type a model id"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') setCustom(false)
          }}
        />
      )}
      {menu}
    </div>
  )
}

interface ListProps {
  providerId: string
  models: PickerModel[]
  loading: boolean
  query: string
  onQuery: (value: string) => void
  value: string
  onPick: (id: string) => void
  onReload: () => void
  onCustom: () => void
  providerLabel?: string
  note?: string | null
  hasQuery: boolean
  placement: Placement | null
}

function ModelList({
  providerId,
  models,
  loading,
  query,
  onQuery,
  value,
  onPick,
  onReload,
  onCustom,
  providerLabel,
  note,
  hasQuery,
  placement
}: ListProps) {
  const style: React.CSSProperties = placement
    ? {
        position: 'fixed',
        top: placement.top,
        left: placement.left,
        width: placement.width,
        ...(placement.above ? { transform: 'translateY(-100%)' } : {})
      }
    : { position: 'fixed', top: 0, left: 0, opacity: 0 }

  return createPortal(
    <div className="model-picker__menu" role="listbox" style={style} data-provider={providerId}>
      <div className="model-picker__search">
        <Search className="icon icon--xs" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search models"
          aria-label="Search models"
          autoFocus
        />
      </div>
      <div className="model-picker__list">
        {loading && models.length === 0 && (
          <div className="model-picker__empty">
            <Loader2 className="icon icon--xs spin" aria-hidden="true" /> Asking the provider…
          </div>
        )}
        {!loading && models.length === 0 && !hasQuery && (
          <div className="model-picker__empty">
            {note ?? `No models to show${providerLabel ? ` for ${providerLabel}` : ''}.`}
            <button className="btn btn--ghost btn--sm" onClick={onReload}>
              Try again
            </button>
          </div>
        )}
        {!loading && models.length === 0 && hasQuery && (
          <div className="model-picker__empty">No model matches “{query}”.</div>
        )}
        {models.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`model-picker__option${entry.id === value ? ' model-picker__option--active' : ''}`}
            onClick={() => onPick(entry.id)}
            role="option"
            aria-selected={entry.id === value}
            title={entry.id}
          >
            <span className="model-picker__option-name">{entry.name}</span>
            {entry.provider && (
              <span className="model-picker__option-provider">{entry.provider.replace(/^MODEL_PROVIDER_/, '')}</span>
            )}
            {entry.free && <span className="pill pill--ok">Free</span>}
            {entry.quota !== null && entry.quota < 0.2 && (
              <span className="pill pill--warn">{Math.round(entry.quota * 100)}%</span>
            )}
            {entry.id === value && <Check className="icon icon--xs" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <button type="button" className="model-picker__custom-link" onClick={onCustom}>
        Type a model id instead
      </button>
    </div>,
    document.body
  )
}
