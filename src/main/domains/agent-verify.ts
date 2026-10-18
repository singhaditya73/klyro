import type { AgentAction, AgentStepStatus } from '@shared/types'

/**
 * Screen-verification primitives.
 *
 * A successful `xdotool`/`ydotool`/PowerShell call only proves that input was
 * *submitted*. To know whether it had an effect we compare the frame captured
 * before the action with the frame captured right after, and combine that with
 * what the action was expected to do.
 */

export interface PixelFrame {
  /** Raw BGRA pixels as produced by `nativeImage.toBitmap()`. */
  data: Buffer
  width: number
  height: number
}

/** Fraction of sampled pixels that must differ to count as a visible change. */
export const CHANGE_THRESHOLD = 0.004
/** Never sample more than this many pixels — keeps verification cheap. */
export const MAX_SAMPLES = 40_000
/** Per-channel difference below this is treated as identical (noise). */
const CHANNEL_TOLERANCE = 12

/**
 * Estimate the fraction of pixels that changed between two frames.
 * Returns 1 when the frames are a different size (e.g. resolution changed),
 * which is the conservative "definitely changed" answer.
 */
export function frameDiffRatio(before: PixelFrame, after: PixelFrame): number {
  if (
    before.width !== after.width ||
    before.height !== after.height ||
    before.data.length !== after.data.length
  ) {
    return 1
  }
  const pixelCount = before.width * before.height
  if (pixelCount <= 0) return 0
  const stride = Math.max(1, Math.floor(pixelCount / MAX_SAMPLES))
  let sampled = 0
  let changed = 0

  for (let pixel = 0; pixel < pixelCount; pixel += stride) {
    const offset = pixel * 4
    sampled += 1
    const db = Math.abs(before.data[offset] - after.data[offset])
    const dg = Math.abs(before.data[offset + 1] - after.data[offset + 1])
    const dr = Math.abs(before.data[offset + 2] - after.data[offset + 2])
    if (Math.max(db, dg, dr) > CHANNEL_TOLERANCE) changed += 1
  }
  return sampled === 0 ? 0 : changed / sampled
}

export interface OutcomeAssessment {
  status: AgentStepStatus
  verified: boolean
  screenChanged: boolean
  detail: string
}

/**
 * Interpret a before/after comparison for an action.
 *
 * - Actions that should change the UI become `verified` when the screen changed
 *   and `unverified` when it did not (so the planner can try a different tactic).
 * - Actions that should not change the UI (move/wait) are `executed`; if the
 *   screen did change anyway the result is `ambiguous`.
 */
export function assessActionOutcome(
  action: AgentAction,
  ratio: number,
  threshold = CHANGE_THRESHOLD
): OutcomeAssessment {
  const screenChanged = ratio >= threshold
  const percent = Math.round(ratio * 1000) / 10

  switch (action.type) {
    case 'move':
    case 'wait':
    case 'screenshot':
      return {
        status: screenChanged ? 'ambiguous' : 'executed',
        verified: true,
        screenChanged,
        detail: screenChanged ? 'Screen changed while the action was running.' : 'No screen change was expected.'
      }
    case 'done':
    case 'ask':
      return { status: 'executed', verified: true, screenChanged, detail: '' }
    default:
      return screenChanged
        ? { status: 'verified', verified: true, screenChanged, detail: `Screen changed (${percent}% of pixels).` }
        : {
            status: 'unverified',
            verified: false,
            screenChanged,
            detail: 'No visible change after the action — the intended effect may not have happened.'
          }
  }
}
