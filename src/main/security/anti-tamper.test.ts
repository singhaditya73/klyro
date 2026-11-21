import { describe, expect, it } from 'vitest'
import {
  containsProhibitedFlags,
  hasUnauthorizedNodeSwitch,
  PROHIBITED_INSPECT_FLAGS
} from './anti-tamper'

describe('Anti-Debugging & Tampering Defenses (Layer 4)', () => {
  it('detects prohibited debugging flags', () => {
    expect(containsProhibitedFlags(['klyro', '--inspect=9229'])).toBe(true)
    expect(containsProhibitedFlags(['klyro', '--inspect-brk'])).toBe(true)
    expect(containsProhibitedFlags(['klyro', '--remote-debugging-port=9222'])).toBe(true)
    expect(containsProhibitedFlags(['klyro', '--enable-source-maps'])).toBe(true)
  })

  it('allows safe, normal application startup flags', () => {
    expect(containsProhibitedFlags(['klyro', '--enable-gpu-rasterization', '--disable-features=DrawBorderOnScreenCapture'])).toBe(false)
    expect(containsProhibitedFlags([])).toBe(false)
  })

  it('detects ELECTRON_RUN_AS_NODE environment hijacking', () => {
    expect(hasUnauthorizedNodeSwitch({ ELECTRON_RUN_AS_NODE: '1' })).toBe(true)
    expect(hasUnauthorizedNodeSwitch({ ELECTRON_RUN_AS_NODE: 'true' })).toBe(true)
    expect(hasUnauthorizedNodeSwitch({ ELECTRON_RUN_AS_NODE: '0' })).toBe(false)
    expect(hasUnauthorizedNodeSwitch({})).toBe(false)
  })

  it('verifies all prohibited flags list has expected critical debug entrypoints', () => {
    expect(PROHIBITED_INSPECT_FLAGS).toContain('--inspect')
    expect(PROHIBITED_INSPECT_FLAGS).toContain('--inspect-brk')
    expect(PROHIBITED_INSPECT_FLAGS).toContain('--remote-debugging-port')
  })
})

