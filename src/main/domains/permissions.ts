import { systemPreferences } from 'electron'
import type { PermissionState } from '@shared/types'

type Access = 'granted' | 'denied' | 'unknown'

function normalize(status: string): Access {
  if (status === 'granted') return 'granted'
  if (status === 'not-determined') return 'unknown'
  return 'denied'
}

export function checkPermissions(): PermissionState {
  const notes: string[] = []
  if (process.platform === 'darwin') {
    const media = (kind: 'microphone' | 'screen'): Access => {
      try {
        return normalize(systemPreferences.getMediaAccessStatus(kind))
      } catch {
        return 'unknown'
      }
    }
    let accessibility: Access = 'unknown'
    try {
      accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'denied'
    } catch {
      accessibility = 'unknown'
    }
    return {
      microphone: media('microphone'),
      screen: media('screen'),
      accessibility,
      notes
    }
  }

  notes.push('On Windows and Linux, capture permissions are enforced by the OS when you start a capture.')
  return { microphone: 'granted', screen: 'granted', accessibility: 'granted', notes }
}
