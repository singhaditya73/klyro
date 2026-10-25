import { describe, expect, it, vi } from 'vitest'

/**
 * The hide-everything shortcut is an accelerator the user can change or clear.
 * Deciding what to register is pure, so it is tested without an OS: a headless
 * CI session has no global-shortcut seat at all.
 */

vi.mock('electron', () => ({
  globalShortcut: { register: vi.fn(() => true), unregisterAll: vi.fn() }
}))
vi.mock('./settings', () => ({ settingsDomain: { get: () => ({}) } }))
vi.mock('./windows', () => ({ toggleOverlay: vi.fn(), hideEverything: vi.fn() }))

const { shortcutBindings } = await import('./shortcuts')

describe('which shortcuts are registered', () => {
  it('always registers the overlay toggle', () => {
    expect(shortcutBindings({ toggleShortcut: 'CommandOrControl+Shift+Space' })).toEqual([
      { kind: 'toggle', accelerator: 'CommandOrControl+Shift+Space' }
    ])
  })

  it('registers the hide shortcut alongside it', () => {
    expect(
      shortcutBindings({ toggleShortcut: 'CommandOrControl+Shift+Space', panicShortcut: 'CommandOrControl+Shift+H' })
    ).toEqual([
      { kind: 'toggle', accelerator: 'CommandOrControl+Shift+Space' },
      { kind: 'hide', accelerator: 'CommandOrControl+Shift+H' }
    ])
  })

  it('treats an empty hide shortcut as off', () => {
    expect(shortcutBindings({ toggleShortcut: 'A', panicShortcut: '   ' })).toHaveLength(1)
  })

  it('never registers the same accelerator twice', () => {
    const bindings = shortcutBindings({ toggleShortcut: 'A', panicShortcut: 'A' })
    expect(bindings).toHaveLength(1)
    expect(bindings[0].kind).toBe('toggle')
  })

  it('falls back to the documented default when the toggle is cleared', () => {
    expect(shortcutBindings({ toggleShortcut: '' })[0].accelerator).toBe('CommandOrControl+Shift+Space')
  })
})
