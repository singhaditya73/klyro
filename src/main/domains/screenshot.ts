import { desktopCapturer, screen } from 'electron'
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

export async function listCaptureSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: false
  })
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }))
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
