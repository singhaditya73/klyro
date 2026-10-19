// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { useModal } from '../hooks/useModal'

/**
 * Regression: the panel hook used to re-focus the panel whenever the parent
 * rendered with a new `onClose` function. Every keystroke in a text field
 * inside a panel (the agent's goal box, for example) re-rendered the app, so
 * the caret was pulled out of the field after each character.
 */
describe('useModal focus behaviour', () => {
  it('keeps the caret in a field while the panel re-renders with a new onClose', () => {
    function Panel(): React.ReactElement {
      // A fresh closure every render — exactly what the app passes down.
      const [value, setValue] = useState('')
      const ref = useModal(() => undefined)
      return (
        <div ref={ref} tabIndex={-1}>
          <textarea
            aria-label="goal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </div>
      )
    }

    render(<Panel />)
    const field = screen.getByLabelText('goal') as HTMLTextAreaElement
    field.focus()

    fireEvent.change(field, { target: { value: 'Open the calculator' } })

    expect(field.value).toBe('Open the calculator')
    expect(document.activeElement).toBe(field)
  })

  it('still focuses the panel on open and closes on Escape', () => {
    const onClose = vi.fn()
    function Panel(): React.ReactElement {
      const ref = useModal(onClose)
      return <div ref={ref} tabIndex={-1}>panel</div>
    }
    render(<Panel />)
    expect(document.activeElement).toBe(screen.getByText('panel'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
