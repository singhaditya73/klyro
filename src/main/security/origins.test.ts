import { describe, expect, it } from 'vitest'
import {
  isAllowedPermission,
  isExternalHttpUrl,
  isTrustedRendererUrl,
  pathToFileUrl,
  setPackagedRenderer
} from './origins'

describe('pathToFileUrl', () => {
  it('produces an encoded file URL', () => {
    expect(pathToFileUrl('/opt/Klyro/resources/app.asar/out/renderer/index.html')).toBe(
      'file:///opt/Klyro/resources/app.asar/out/renderer/index.html'
    )
    expect(pathToFileUrl('/home/me/My App/index.html')).toBe('file:///home/me/My%20App/index.html')
  })

  it('handles Windows paths', () => {
    expect(pathToFileUrl('C:\\Program Files\\Klyro\\index.html')).toBe(
      'file:///C:/Program%20Files/Klyro/index.html'
    )
  })
})

describe('isTrustedRendererUrl', () => {
  it('rejects everything until the packaged renderer is registered', () => {
    expect(isTrustedRendererUrl('file:///app/index.html')).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example')).toBe(false)
    expect(isTrustedRendererUrl('')).toBe(false)
  })

  it('accepts the registered renderer with and without a route hash', () => {
    setPackagedRenderer('/app/out/renderer/index.html')
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html')).toBe(true)
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html#/overlay')).toBe(true)
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html?x=1')).toBe(true)
  })

  it('rejects lookalike paths and other files', () => {
    setPackagedRenderer('/app/out/renderer/index.html')
    expect(isTrustedRendererUrl('file:///app/out/renderer/index.html.evil')).toBe(false)
    expect(isTrustedRendererUrl('file:///app/out/renderer/other.html')).toBe(false)
    expect(isTrustedRendererUrl('file:///etc/passwd')).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/app/out/renderer/index.html')).toBe(false)
  })
})

describe('isExternalHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isExternalHttpUrl('https://github.com/singhaditya73/klyro')).toBe(true)
    expect(isExternalHttpUrl('http://localhost:1420/')).toBe(true)
  })

  it('rejects schemes that shell.openExternal should never receive', () => {
    expect(isExternalHttpUrl('file:///etc/passwd')).toBe(false)
    expect(isExternalHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isExternalHttpUrl('smb://server/share')).toBe(false)
    expect(isExternalHttpUrl('not a url')).toBe(false)
  })
})

describe('isAllowedPermission', () => {
  it('allows microphone capture and nothing else', () => {
    expect(isAllowedPermission('media')).toBe(true)
    expect(isAllowedPermission('audioCapture')).toBe(true)
    expect(isAllowedPermission('geolocation')).toBe(false)
    expect(isAllowedPermission('notifications')).toBe(false)
    expect(isAllowedPermission('display-capture')).toBe(false)
  })
})
