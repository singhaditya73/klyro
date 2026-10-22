import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The shell is the map of the app: if a destination is missing from the
// sidebar, it is gone for the user.
vi.stubGlobal('window', {
  location: { hash: '#/home' },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
  klyro: new Proxy(
    {},
    {
      get: () => async () => {
        throw new Error('the shell must not call IPC during the initial render')
      }
    }
  )
})

const { default: App } = await import('./App')

describe('the application shell', () => {
  it('names every destination', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Home')
    expect(html).toContain('Models &amp; Agents')
    expect(html).toContain('Knowledge')
    expect(html).toContain('Interviews')
    expect(html).toContain('Settings')
    expect(html).toContain('Privacy &amp; Data')
  })

  it('offers the quick ask from the sidebar', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Quick ask')
  })
})

describe('the shell and a preload that is a build behind', () => {
  it('still draws when the bridge does not have every method', () => {
    // A development session can have a main process from before a change. A
    // missing method must not take the window down with it.
    vi.stubGlobal('window', {
      location: { hash: '#/home' },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      matchMedia: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }),
      klyro: {}
    })
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Home')
    expect(html).toContain('Privacy &amp; Data')
  })
})
