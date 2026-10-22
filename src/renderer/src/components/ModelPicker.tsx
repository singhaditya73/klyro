import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Loader2, RefreshCcw, Search } from 'lucide-react'
import { knownModelNames, rememberModelNames, tidyModelId } from '../lib/modelNames'

/**
 * Pick a model, for one provider or for all of them.
 *
 * In single-provider mode the picker asks that provider for its models, as
 * before. In catalogue mode it is given every usable provider's models at once,
 * grouped by provider, and picking one reports which provider it came from —
 * that is what lets the overlay switch provider without being restarted.
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

export interface PickerGroup {
  id: string
  label: string
  models: PickerModel[]
  note?: string | null
  /** True when the provider runs on this machine, so nothing leaves it. */
  local?: boolean
}

interface Props {
  /** The provider whose models are listed (single-provider mode). */
  providerId?: string
  /** Every provider's models (catalogue mode). Takes precedence over providerId. */
  groups?: PickerGroup[]
  /** The model currently in use. */
  value: string
  onChange: (modelId: string, providerId?: string) => void
  /** Where the picker is used — it changes the compactness. */
  variant?: 'field' | 'chip'
  /** What to call the provider in the empty list. */
  providerLabel?: string
  /** Called when the list is refreshed. */
  onRefresh?: () => void
  /** Called when the menu opens — catalogue mode loads its list here. */
  onOpen?: () => void
  /** Catalogue mode: the list is being fetched. */
  loading?: boolean
  /** Catalogue mode: why the list is empty. */
  note?: string | null
  /** Override the chip label (catalogue mode, before the list has loaded). */
  label?: string
  /** Model ids the person used recently — shown first, in catalogue mode. */
  recent?: string[]
  /**
   * Names for models the provider is not listing right now, by id.
   *
   * An agent IDE can be closed and a local server can be stopped while the
   * model stays the same. The name it had is used instead of its id.
   */
  knownNames?: Record<string, string>
  /** Called when the menu closes — the overlay gives its room back. */
  onClose?: () => void
  /**
   * The provider's name, for the chip.
   *
   * When a model has no name to show — its provider is not listing anything
   * right now — the chip says which provider it is, which is something a
   * person recognises, instead of an internal id.
   */
  contextLabel?: string
}

interface Placement {
  top: number
  left: number
  width: number
  /** True when the list had to open upwards to stay on screen. */
  above: boolean
  /** The height the menu may take. The list scrolls inside it. */
  maxHeight: number
}

/** The id of the group that holds the models used recently. */
const RECENT_GROUP_ID = '__recent__'

/** The height the menu would like to have. */
const MENU_HEIGHT = 320
/** Below this the menu is barely usable, so it opens the other way. */
const MENU_MIN_HEIGHT = 200
/** The smallest menu worth showing; the list scrolls inside it. */
const MENU_TINY_HEIGHT = 120
/** The gap between the control and the menu, and to the window edge. */
const MENU_GAP = 6
const MENU_MARGIN = 8

export function ModelPicker({
  providerId,
  groups,
  value,
  onChange,
  variant = 'field',
  providerLabel,
  onRefresh,
  onOpen,
  loading: externalLoading,
  note: externalNote,
  label: labelOverride,
  recent,
  knownNames,
  onClose,
  contextLabel
}: Props) {
  const [models, setModels] = useState<PickerModel[] | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState(false)
  const [placement, setPlacement] = useState<Placement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  /** Bumped when the window changes size, to place the menu again. */
  const [placementTick, setPlacementTick] = useState(0)
  /** The names models had when they were last listed, on this machine. */
  const [storedNames, setStoredNames] = useState<Record<string, string>>({})
  /** The provider the list currently belongs to, so a stale answer is dropped. */
  const providerRef = useRef(providerId)

  providerRef.current = providerId
  const catalogue = groups !== undefined

  const load = useCallback(async (): Promise<void> => {
    if (catalogue) {
      onRefresh?.()
      return
    }
    const requested = providerId
    if (!requested) return
    setLoading(true)
    try {
      const result = await window.klyro.providerModels(requested)
      // The provider may have changed while the answer was on its way: a
      // late answer for the old provider must not replace the new list.
      if (providerRef.current !== requested) return
      setModels(result.models ?? [])
      setNote(result.note ?? null)
      // Remember what the models are called: the name is shown even when this
      // provider is not running.
      rememberModelNames(result.models ?? [])
      setStoredNames(knownModelNames())
      onRefresh?.()
    } catch {
      if (providerRef.current !== requested) return
      setModels([])
      setNote('Could not ask the provider for its models.')
    } finally {
      if (providerRef.current === requested) setLoading(false)
    }
  }, [catalogue, onRefresh, providerId])

  // Ask the provider what it has, and again whenever the provider changes.
  useEffect(() => {
    if (catalogue) return
    void load()
  }, [catalogue, load])

  // The names that were seen last time, for a provider that is not answering.
  useEffect(() => {
    setStoredNames(knownModelNames())
  }, [])

  /**
   * Place the list next to the control, inside the window it belongs to.
   *
   * The overlay is a small window, so a menu that simply hangs below the
   * control is clipped by the window's own edge. The space that actually
   * exists decides: open downwards when there is room, upwards when there is
   * more room above, and in the worst case take what is there and let the
   * list scroll inside.
   */
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom - MENU_MARGIN
    const spaceAbove = rect.top - MENU_MARGIN
    const flip = spaceBelow < MENU_MIN_HEIGHT && spaceAbove > spaceBelow
    const room = flip ? spaceAbove : spaceBelow
    const maxHeight = Math.max(MENU_TINY_HEIGHT, Math.min(MENU_HEIGHT, room))
    const width = Math.min(Math.max(240, rect.width), window.innerWidth - MENU_MARGIN * 2)
    setPlacement({
      top: flip ? Math.max(MENU_MARGIN, rect.top - MENU_GAP) : rect.bottom + MENU_GAP,
      left: Math.min(Math.max(MENU_MARGIN, rect.left), window.innerWidth - width - MENU_MARGIN),
      width,
      above: flip,
      maxHeight
    })
  }, [open, models, groups, placementTick])

  // The window may grow while the menu is open — the overlay gives the menu
  // room — so the placement is measured again whenever that happens.
  useEffect(() => {
    if (!open) return
    const onResize = (): void => setPlacementTick((tick) => tick + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open])

  // Close when the click lands outside the picker.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: MouseEvent): void {
      const target = event.target as Node
      if (triggerRef.current?.contains(target)) return
      if ((target as HTMLElement).closest?.('.model-picker__menu')) return
      setOpen(false)
      onClose?.()
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false)
        onClose?.()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const allModels = useMemo(
    () => (catalogue ? (groups ?? []).flatMap((group) => group.models) : (models ?? [])),
    [catalogue, groups, models]
  )

  /**
   * Which provider each model belongs to.
   *
   * A model that is shown under “Recent” belongs to whichever provider listed
   * it, not to the “Recent” group — so picking it switches to that provider
   * instead of writing a provider that does not exist.
   */
  const modelProviders = useMemo((): Map<string, string> => {
    const map = new Map<string, string>()
    for (const group of groups ?? []) {
      for (const model of group.models) map.set(model.id, group.id)
    }
    return map
  }, [groups])

  /** The groups after the search box, with empty groups dropped. */
  const filteredGroups = useMemo((): PickerGroup[] => {
    const source: PickerGroup[] = catalogue
      ? (groups ?? [])
      : [{ id: providerId ?? '', label: providerLabel ?? '', models: models ?? [] }]
    const needle = query.trim().toLowerCase()
    if (!needle) return source
    return source
      .map((group) => ({
        ...group,
        models: group.models.filter(
          (entry) =>
            entry.id.toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle) ||
            entry.provider.toLowerCase().includes(needle)
        )
      }))
      .filter((group) => group.models.length > 0)
  }, [catalogue, groups, models, providerId, providerLabel, query])

  const isBusy = externalLoading === true || loading
  const shownNote = catalogue ? (externalNote ?? null) : note
  const selected = allModels.find((entry) => entry.id === value)
  /**
   * What the control says.
   *
   * The name the provider gives its model comes first. When the provider is
   * not listing right now, the name it had last time is used — the id is
   * internal and is never the first thing a person sees.
   */
  const names = knownNames ?? storedNames
  const unknownId = value ? tidyModelId(value) : ''
  const label =
    selected?.name ||
    names[value] ||
    labelOverride ||
    (unknownId
      ? variant === 'chip' && contextLabel
        ? `${contextLabel} · ${unknownId}`
        : unknownId
      : 'Pick a model')
  const hasQuery = query.trim().length > 0

  const openMenu = (): void => {
    setOpen((previous) => {
      const next = !previous
      if (next) onOpen?.()
      else onClose?.()
      return next
    })
  }

  /**
   * The models used recently, in the order they were used.
   *
   * They are shown above the catalogue, because the model someone picked five
   * minutes ago is usually the one they want again.
   */
  const recentGroup = useMemo((): PickerGroup | null => {
    if (!catalogue || !recent || recent.length === 0) return null
    const needle = query.trim().toLowerCase()
    const models = recent
      .map((id) => allModels.find((entry) => entry.id === id))
      .filter((entry): entry is PickerModel => Boolean(entry))
      // The search applies here too: a recent model that does not match is
      // not what was asked for.
      .filter((entry) =>
        needle
          ? entry.id.toLowerCase().includes(needle) ||
            entry.name.toLowerCase().includes(needle) ||
            entry.provider.toLowerCase().includes(needle)
          : true
      )
    if (models.length === 0) return null
    return { id: RECENT_GROUP_ID, label: 'Recent', models }
  }, [allModels, catalogue, query, recent])

  const menu = open ? (
    <ModelList
      groups={recentGroup ? [recentGroup, ...filteredGroups] : filteredGroups}
      showHeaders={catalogue}
      loading={isBusy}
      query={query}
      onQuery={setQuery}
      value={value}
      onPick={(id, groupId) => {
        // A model from the “Recent” group is picked from the provider that
        // listed it.
        const provider = groupId === RECENT_GROUP_ID ? modelProviders.get(id) : groupId
        onChange(id, provider)
        setOpen(false)
        onClose?.()
      }}
      onReload={() => void load()}
      onCustom={() => {
        setCustom(true)
        setOpen(false)
      }}
      providerLabel={providerLabel}
      note={shownNote}
      hasQuery={hasQuery}
      placement={placement}
    />
  ) : null

  const customInput = custom ? (
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
  ) : null

  if (variant === 'chip') {
    return (
      <div className="model-picker model-picker--chip" data-provider={providerId ?? 'catalogue'}>
        <button
          type="button"
          ref={triggerRef}
          className="model-picker__chip"
          onClick={openMenu}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={value ? `${label} — ${value}` : 'Pick a model'}
        >
          <span className="model-picker__chip-label">{label}</span>
          <ChevronDown className="icon icon--xs" aria-hidden="true" />
        </button>
        {customInput}
        {menu}
      </div>
    )
  }

  return (
    <div className="model-picker" data-provider={providerId ?? 'catalogue'}>
      <div className="model-picker__control">
        <button
          type="button"
          ref={triggerRef}
          className="model-picker__button"
          onClick={openMenu}
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
          disabled={isBusy}
          title={catalogue ? 'Ask every provider for its models' : 'Ask the provider for its models'}
          aria-label="Detect models"
        >
          {isBusy ? (
            <Loader2 className="icon icon--xs spin" aria-hidden="true" />
          ) : (
            <RefreshCcw className="icon icon--xs" aria-hidden="true" />
          )}
        </button>
      </div>
      {customInput}
      {menu}
    </div>
  )
}

interface ListProps {
  groups: PickerGroup[]
  /** Catalogue mode: say which provider each group belongs to. */
  showHeaders: boolean
  loading: boolean
  query: string
  onQuery: (value: string) => void
  value: string
  onPick: (id: string, providerId?: string) => void
  onReload: () => void
  onCustom: () => void
  providerLabel?: string
  note?: string | null
  hasQuery: boolean
  placement: Placement | null
}

function ModelList({
  groups,
  showHeaders,
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
        // The menu never grows past the space the window has: the list scrolls
        // inside it, so the search box and the options stay reachable.
        maxHeight: placement.maxHeight,
        ...(placement.above ? { transform: 'translateY(-100%)' } : {})
      }
    : { position: 'fixed', top: 0, left: 0, opacity: 0 }

  const total = groups.reduce((sum, group) => sum + group.models.length, 0)

  return createPortal(
    <div className="model-picker__menu" role="listbox" style={style}>
      <div className="model-picker__search">
        <Search className="icon icon--xs" aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder={groupLabelPlaceholder(showHeaders)}
          aria-label="Search models"
          autoFocus
        />
      </div>
      <div className="model-picker__list">
        {loading && total === 0 && (
          <div className="model-picker__empty">
            <Loader2 className="icon icon--xs spin" aria-hidden="true" /> Asking the providers…
          </div>
        )}
        {!loading && total === 0 && !hasQuery && (
          <div className="model-picker__empty">
            {note ?? `No models to show${providerLabel ? ` for ${providerLabel}` : ''}.`}
            <button className="btn btn--ghost btn--sm" onClick={onReload}>
              Try again
            </button>
          </div>
        )}
        {!loading && total === 0 && hasQuery && (
          <div className="model-picker__empty">No model matches “{query}”.</div>
        )}
        {groups.map((group) => (
          <div key={group.id || 'models'} className="model-picker__group">
            {showHeaders && (
              <div className="model-picker__group-head">
                <span className="row" style={{ gap: 6 }}>
                  <span>{group.label}</span>
                  {group.local !== undefined && (
                    <span className={`pill ${group.local ? 'pill--ok' : ''}`}>{group.local ? 'Local' : 'Hosted'}</span>
                  )}
                </span>
                <span className="model-picker__group-count">{group.models.length}</span>
              </div>
            )}
            {group.models.map((entry) => (
              <button
                key={`${group.id}:${entry.id}`}
                type="button"
                className={`model-picker__option${entry.id === value ? ' model-picker__option--active' : ''}`}
                onClick={() => onPick(entry.id, group.id || undefined)}
                role="option"
                aria-selected={entry.id === value}
                title={entry.name && entry.name !== entry.id ? `${entry.name} — ${entry.id}` : entry.id}
              >
                <span className="model-picker__option-name">{entry.name}</span>
                {entry.provider && !showHeaders && (
                  <span className="model-picker__option-provider">{entry.provider.replace(/^MODEL_PROVIDER_/, '')}</span>
                )}
                {entry.free && <span className="pill pill--ok">Free</span>}
                {entry.quota !== null && entry.quota < 0.2 && (
                  <span className="pill pill--warn">{Math.round(entry.quota * 100)}%</span>
                )}
                {entry.id === value && <Check className="icon icon--xs" aria-hidden="true" />}
              </button>
            ))}
            {showHeaders && group.note && group.models.length === 0 && (
              <div className="model-picker__empty">{group.note}</div>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="model-picker__custom-link" onClick={onCustom}>
        Type a model id instead
      </button>
    </div>,
    document.body
  )
}

function groupLabelPlaceholder(showHeaders: boolean): string {
  return showHeaders ? 'Search every connected model' : 'Search models'
}
