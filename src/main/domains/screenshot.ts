import { desktopCapturer } from 'electron'
import type { CaptureResult, CaptureSource } from '@shared/types'

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
