// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

/**
 * A window that throws shows a white rectangle. This makes it say what
 * happened instead, and offers a reload.
 */

afterEach(cleanup)

function Boom(): React.ReactNode {
  throw new Error('the window could not be drawn')
}

describe('the error boundary', () => {
  it('shows what went wrong instead of a blank window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    )

    expect(screen.getByText('Klyro hit an error')).toBeTruthy()
    expect(screen.getByText('the window could not be drawn')).toBeTruthy()
    expect(screen.getByText('Reload the window')).toBeTruthy()
    spy.mockRestore()
  })

  it('leaves a working interface alone', () => {
    render(
      <ErrorBoundary>
        <div>the panel</div>
      </ErrorBoundary>
    )
    expect(screen.getByText('the panel')).toBeTruthy()
  })
})
