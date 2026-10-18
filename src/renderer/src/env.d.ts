import type { KlyroApi } from '@shared/types'

declare global {
  interface Window {
    klyro: KlyroApi
  }
}

export {}
