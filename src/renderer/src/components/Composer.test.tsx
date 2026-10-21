// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { Composer } from './Composer'

/**
 * Regression: the composer's text was cleared only after the whole answer had
 * arrived, because `await onSend(...)` resolves when the model is done. So
 * while the model was thinking, the question was still sitting in the box —
 * the same text twice on screen.
 *
 * The box must empty the moment you press Send, and the text must come back
 * if the question never left the app.
 */

// The composer only asks the main process for the settings, so that is the
// only thing the test needs to provide.
Object.defineProperty(window, 'klyro', {
  configurable: true,
  value: {
    getSettings: async () => ({ activeProvider: 'antigravity', providers: { antigravity: { model: 'x' } } })
  }
})

describe('the composer', () => {
  afterEach(() => cleanup())

  it('empties as soon as the question is sent, not when the answer arrives', async () => {
    const gate: { release: () => void } = { release: () => undefined }
    const onSend = vi.fn(
      (_content: string, _attachments: unknown[]) =>
        new Promise<void>((resolve) => {
          gate.release = resolve
        })
    )
    render(<Composer busy={false} onSend={onSend} onStop={() => undefined} />)

    const area = screen.getByLabelText('Message Klyro') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'Why is the sky blue?' } })
    expect(area.value).toBe('Why is the sky blue?')

    fireEvent.keyDown(area, { key: 'Enter' })

    // The question has been handed over…
    expect(onSend).toHaveBeenCalledWith('Why is the sky blue?', [])
    // …and the box is already empty while the model is still thinking.
    await waitFor(() => expect(area.value).toBe(''))

    gate.release()
  })

  it('puts the question back when it could not be sent', async () => {
    const onSend = vi.fn(async () => {
      throw new Error('the provider is not configured')
    })
    render(<Composer busy={false} onSend={onSend} onStop={() => undefined} />)

    const area = screen.getByLabelText('Message Klyro') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'A question worth keeping' } })
    fireEvent.keyDown(area, { key: 'Enter' })

    await waitFor(() => expect(area.value).toBe('A question worth keeping'))
    expect(screen.getByText('the provider is not configured')).toBeTruthy()
  })

  it('does not send twice while an answer is coming in', async () => {
    const onSend = vi.fn(async (_content: string, _attachments: unknown[]) => undefined)
    function Wrapper(): React.ReactElement {
      const [busy, setBusy] = useState(false)
      return (
        <Composer
          busy={busy}
          onSend={async (content, attachments) => {
            setBusy(true)
            await onSend(content, attachments)
          }}
          onStop={() => undefined}
        />
      )
    }
    render(<Wrapper />)

    const area = screen.getByLabelText('Message Klyro') as HTMLTextAreaElement
    fireEvent.change(area, { target: { value: 'One' } })
    fireEvent.keyDown(area, { key: 'Enter' })
    await waitFor(() => expect(area.value).toBe(''))

    fireEvent.change(area, { target: { value: 'Two' } })
    fireEvent.keyDown(area, { key: 'Enter' })
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
