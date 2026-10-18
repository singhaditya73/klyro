/** Origin policy shared by the window guards and the permission policy. */

const DEV_URL = process.env.ELECTRON_RENDERER_URL ?? ''

let packagedRendererUrl: string | null = null

/** Registered once at startup with the on-disk path of the packaged renderer. */
export function setPackagedRenderer(file: string): void {
  packagedRendererUrl = pathToFileUrl(file)
}

export function pathToFileUrl(file: string): string {
  const normalized = file.replace(/\\/g, '/')
  const withSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(`file://${withSlash}`)
}

function withoutQueryOrHash(url: string): string {
  return url.split('#')[0].split('?')[0]
}

/** True only for Klyro's own renderer — the packaged HTML file, or the dev server. */
export function isTrustedRendererUrl(url: string): boolean {
  if (!url) return false
  const bare = withoutQueryOrHash(url)
  if (packagedRendererUrl && bare === packagedRendererUrl) return true
  if (DEV_URL && url.startsWith(DEV_URL)) return true
  return false
}

/** True for links we are willing to hand to the user's default browser. */
export function isExternalHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Microphone is the only capability Klyro's renderer may request. */
export function isAllowedPermission(permission: string): boolean {
  return permission === 'media' || permission === 'audioCapture'
}
