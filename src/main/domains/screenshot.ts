import { desktopCapturer, screen, BrowserWindow } from 'electron'
import type { CaptureResult, CaptureSource } from '@shared/types'

export interface AgentFrame {
  dataUrl: string
  /** Raw BGRA pixels, for before/after verification. */
  bitmap: Buffer
  imageWidth: number
  imageHeight: number
  screenWidth: number
  screenHeight: number
  name: string
}

/** Klyro's own windows must never appear as a capture target. */
function isOwnWindow(name: string): boolean {
  if (!name) return false
  const lowered = name.toLowerCase()
  return lowered.includes('klyro')
}

export async function listCaptureSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: false
  })
  return sources
    .filter((source) => source.name.startsWith('screen') || !isOwnWindow(source.name))
    .map((source) => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }))
}

/**
 * Hide Klyro's own windows for a moment so a full-screen capture shows the
 * user's work, not the app they are asking about. A screenshot of Klyro asking
 * about Klyro is useless.
 */
async function withSelfHidden<T>(action: () => Promise<T>): Promise<T> {
  const hidden: BrowserWindow[] = []
  const focused = BrowserWindow.getFocusedWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !win.isVisible()) continue
    hidden.push(win)
    win.hide()
  }
  if (hidden.length === 0) return action()
  // Give the compositor a moment to actually repaint without our windows.
  await new Promise((resolve) => setTimeout(resolve, 180))
  try {
    return await action()
  } finally {
    for (const win of hidden) {
      if (win.isDestroyed()) continue
      win.show()
    }
    if (focused && !focused.isDestroyed()) focused.focus()
  }
}

export async function grabScreen(sourceId?: string): Promise<CaptureResult> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false
  })
  if (sources.length === 0) {
    throw new Error('No screen sources available. Screen recording permission may be required.')
  }
  const chosen =
    (sourceId ? sources.find((s) => s.id === sourceId) : undefined) ??
    sources.find((s) => s.id.startsWith('screen')) ??
    sources[0]
  // A whole-screen capture must not include Klyro itself; a specific window
  // capture is left alone (the user picked that window on purpose).
  if (!sourceId) {
    const dataUrl = await withSelfHidden(async () => {
      const fresh = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false
      })
      const target =
        fresh.find((s) => s.id === chosen.id) ?? fresh.find((s) => s.id.startsWith('screen')) ?? fresh[0]
      return { dataUrl: target.thumbnail.toDataURL(), name: target.name }
    })
    return dataUrl
  }
  return { dataUrl: chosen.thumbnail.toDataURL(), name: chosen.name }
}

/** Physical-pixel capture of the primary display for the agent, with the
 *  dimensions needed to map model coordinates back to screen coordinates. */
export async function captureForAgent(): Promise<AgentFrame> {
  const display = screen.getPrimaryDisplay()
  const pixelWidth = Math.max(1, Math.round(display.size.width * display.scaleFactor))
  const pixelHeight = Math.max(1, Math.round(display.size.height * display.scaleFactor))
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: pixelWidth, height: pixelHeight },
    fetchWindowIcons: false
  })
  if (sources.length === 0) {
    throw new Error('No screen available for capture. Screen recording permission may be required.')
  }
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  const size = source.thumbnail.getSize()
  return {
    dataUrl: source.thumbnail.toDataURL(),
    bitmap: source.thumbnail.toBitmap(),
    imageWidth: size.width,
    imageHeight: size.height,
    screenWidth: display.size.width,
    screenHeight: display.size.height,
    name: source.name
  }
}
