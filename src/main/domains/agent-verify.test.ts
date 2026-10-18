import { describe, expect, it } from 'vitest'
import { assessActionOutcome, frameDiffRatio, type PixelFrame } from './agent-verify'

function frame(width: number, height: number, fill: number): PixelFrame {
  const data = Buffer.alloc(width * height * 4, fill)
  return { data, width, height }
}

describe('frameDiffRatio', () => {
  it('is zero for identical frames', () => {
    expect(frameDiffRatio(frame(20, 20, 10), frame(20, 20, 10))).toBe(0)
  })

  it('is one when every sampled pixel differs', () => {
    expect(frameDiffRatio(frame(20, 20, 0), frame(20, 20, 255))).toBe(1)
  })

  it('reports a partial change', () => {
    const before = frame(40, 40, 0)
    const after = frame(40, 40, 0)
    // Paint one quarter of the pixels a clearly different value.
    for (let pixel = 0; pixel < 400; pixel++) after.data[pixel * 4] = 200
    const ratio = frameDiffRatio(before, after)
    expect(ratio).toBeGreaterThan(0.2)
    expect(ratio).toBeLessThan(0.35)
  })

  it('treats a size change as a definite change', () => {
    expect(frameDiffRatio(frame(10, 10, 0), frame(20, 20, 0))).toBe(1)
  })

  it('ignores sub-threshold noise', () => {
    const before = frame(20, 20, 100)
    const after = frame(20, 20, 100)
    for (let offset = 0; offset < after.data.length; offset++) after.data[offset] = 104
    expect(frameDiffRatio(before, after)).toBe(0)
  })
})

describe('assessActionOutcome', () => {
  it('verifies input actions that changed the screen', () => {
    expect(assessActionOutcome({ type: 'click', x: 1, y: 1 }, 0.5)).toMatchObject({
      status: 'verified',
      verified: true,
      screenChanged: true
    })
  })

  it('marks input actions with no visible effect as unverified', () => {
    expect(assessActionOutcome({ type: 'type', text: 'hi' }, 0)).toMatchObject({
      status: 'unverified',
      verified: false,
      screenChanged: false
    })
  })

  it('does not require a change for cursor movement', () => {
    expect(assessActionOutcome({ type: 'move', x: 1, y: 1 }, 0).status).toBe('executed')
    expect(assessActionOutcome({ type: 'move', x: 1, y: 1 }, 0.9).status).toBe('ambiguous')
  })

  it('treats a wait as executed regardless of change', () => {
    expect(assessActionOutcome({ type: 'wait', ms: 100 }, 0.3).status).toBe('ambiguous')
    expect(assessActionOutcome({ type: 'wait', ms: 100 }, 0).status).toBe('executed')
  })
})
