// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { ModelPicker } from './ModelPicker'

/**
 * The overlay's picker lists every connected provider, not just the active one,
 * and reports which provider a chosen model came from. That is what lets the
 * overlay switch provider without a restart.
 *
 * It also has to work inside the overlay, which is a small window: the menu
 * may not be clipped by the window's edge, and the control may not show an
 * internal id when the provider is not listing its models.
 */

afterEach(cleanup)

window.klyro = {
  providerModels: vi.fn(async () => ({ models: [], note: null }))
} as unknown as typeof window.klyro

const groups = [
  {
    id: 'opencode',
    label: 'OpenCode',
    note: null,
    models: [
      { id: 'opencode/big-pickle', name: 'Big Pickle', provider: 'opencode', quota: null, free: true },
      { id: 'opencode/claude-sonnet-4', name: 'Claude Sonnet 4', provider: 'anthropic', quota: null, free: false }
    ]
  },
  {
    id: 'ollama',
    label: 'Ollama',
    note: null,
    models: [{ id: 'llama3.1', name: 'Llama 3.1', provider: 'meta', quota: null, free: true }]
  }
]

/** Puts the control at a known place in a known window. */
function placeControl(top: number, bottom: number, windowHeight: number): void {
  Object.defineProperty(window, 'innerHeight', { value: windowHeight, configurable: true, writable: true })
  Object.defineProperty(window, 'innerWidth', { value: 640, configurable: true, writable: true })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('model-picker__chip')) {
      return { top, bottom, left: 85, right: 200, width: 115, height: 27, x: 85, y: top, toJSON: () => ({}) } as DOMRect
    }
    return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  })
}

describe('ModelPicker, every provider', () => {
  it('shows the provider groups when the chip opens', () => {
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))

    expect(screen.getByText('OpenCode')).toBeTruthy()
    expect(screen.getByText('Ollama')).toBeTruthy()
    expect(screen.getByText('Big Pickle')).toBeTruthy()
  })

  it('reports the provider along with the model', () => {
    const onChange = vi.fn()
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={onChange} />)

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))
    fireEvent.click(screen.getByText('Claude Sonnet 4'))

    expect(onChange).toHaveBeenCalledWith('opencode/claude-sonnet-4', 'opencode')
  })

  it('loads the catalogue when it is opened, not while it is closed', () => {
    const onOpen = vi.fn()
    render(
      <ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} onOpen={onOpen} />
    )

    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('searches across providers', () => {
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))
    fireEvent.change(screen.getByLabelText('Search models'), { target: { value: 'sonnet' } })

    const menu = screen.getByRole('listbox')
    expect(within(menu).getByText('Claude Sonnet 4')).toBeTruthy()
    expect(within(menu).queryByText('Big Pickle')).toBeNull()
    expect(within(menu).queryByText('Llama 3.1')).toBeNull()
  })

  it('says who to connect when there is nothing to show', () => {
    render(
      <ModelPicker
        groups={[]}
        value=""
        variant="chip"
        note="No provider is connected yet."
        onChange={() => undefined}
      />
    )

    fireEvent.click(screen.getByTitle('Pick a model'))
    expect(screen.getByText('No provider is connected yet.')).toBeTruthy()
  })

  it('shows the label it was given before the list has loaded', () => {
    render(
      <ModelPicker
        groups={[]}
        value=""
        label="Pick a model"
        variant="chip"
        onChange={() => undefined}
      />
    )
    expect(screen.getByText('Pick a model')).toBeTruthy()
  })
})

describe('ModelPicker, what the control says', () => {
  it('shows the name the provider gives its model', () => {
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)
    expect(screen.getByText('Llama 3.1')).toBeTruthy()
  })

  it('shows the name the model had when it was last listed', () => {
    render(
      <ModelPicker
        groups={[]}
        value="MODEL_PLACEHOLDER_M26"
        variant="chip"
        knownNames={{ 'MODEL_PLACEHOLDER_M26': 'Claude Opus 4.6 (Thinking)' }}
        onChange={() => undefined}
      />
    )
    expect(screen.getByText('Claude Opus 4.6 (Thinking)')).toBeTruthy()
  })

  it('names the provider when the model has no name at all', () => {
    render(
      <ModelPicker
        groups={[]}
        value="MODEL_PLACEHOLDER_M50"
        variant="chip"
        contextLabel="Antigravity"
        onChange={() => undefined}
      />
    )
    expect(screen.getByText('Antigravity · M50')).toBeTruthy()
    // The internal id is still there for anyone who needs it.
    expect(screen.getByTitle('Antigravity · M50 — MODEL_PLACEHOLDER_M50')).toBeTruthy()
  })
})

describe('ModelPicker, the models used recently', () => {
  it('offers them first', () => {
    render(
      <ModelPicker
        groups={groups}
        value="llama3.1"
        variant="chip"
        recent={['opencode/big-pickle']}
        onChange={() => undefined}
      />
    )

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))
    const heads = screen.getAllByText('Recent')
    expect(heads.length).toBeGreaterThan(0)
  })

  it('switches to the provider that listed them, not to a group called recent', () => {
    const onChange = vi.fn()
    render(
      <ModelPicker
        groups={groups}
        value="llama3.1"
        variant="chip"
        recent={['opencode/big-pickle']}
        onChange={onChange}
      />
    )

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))
    const option = screen.getAllByText('Big Pickle')[0]
    fireEvent.click(option)

    // The provider is the one the model came from: a "recent" group is not a
    // provider, and writing it as one would be refused by the settings.
    expect(onChange).toHaveBeenCalledWith('opencode/big-pickle', 'opencode')
  })
})

describe('ModelPicker, inside a small window', () => {
  it('opens upwards when there is no room below', () => {
    placeControl(700, 727, 768)
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))

    const menu = screen.getByRole('listbox')
    expect(menu.style.transform).toContain('translateY(-100%)')
    vi.restoreAllMocks()
  })

  it('never grows past the room the window has', () => {
    // The overlay: 151 px tall, the chip at the top.
    placeControl(13, 40, 151)
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Llama 3.1 — llama3.1'))

    const menu = screen.getByRole('listbox')
    const height = Number.parseFloat(menu.style.maxHeight)
    expect(height).toBeGreaterThan(0)
    expect(height).toBeLessThanOrEqual(151)
    vi.restoreAllMocks()
  })
})
