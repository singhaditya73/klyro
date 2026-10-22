// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react'
import { ModelPicker } from './ModelPicker'

/**
 * The overlay's picker lists every connected provider, not just the active one,
 * and reports which provider a chosen model came from. That is what lets the
 * overlay switch provider without a restart.
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

describe('ModelPicker, every provider', () => {
  it('shows the provider groups when the chip opens', () => {
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Model: llama3.1'))

    expect(screen.getByText('OpenCode')).toBeTruthy()
    expect(screen.getByText('Ollama')).toBeTruthy()
    expect(screen.getByText('Big Pickle')).toBeTruthy()
  })

  it('reports the provider along with the model', () => {
    const onChange = vi.fn()
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={onChange} />)

    fireEvent.click(screen.getByTitle('Model: llama3.1'))
    fireEvent.click(screen.getByText('Claude Sonnet 4'))

    expect(onChange).toHaveBeenCalledWith('opencode/claude-sonnet-4', 'opencode')
  })

  it('loads the catalogue when it is opened, not while it is closed', () => {
    const onOpen = vi.fn()
    render(
      <ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} onOpen={onOpen} />
    )

    expect(onOpen).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTitle('Model: llama3.1'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('searches across providers', () => {
    render(<ModelPicker groups={groups} value="llama3.1" variant="chip" onChange={() => undefined} />)

    fireEvent.click(screen.getByTitle('Model: llama3.1'))
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

    fireEvent.click(screen.getByTitle('Model: not set'))
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
