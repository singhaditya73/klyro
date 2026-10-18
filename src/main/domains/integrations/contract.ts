import type { IntegrationId, IntegrationStatus } from '@shared/types'

/**
 * The integration contract (Phase G1).
 *
 * Every integration implements `IntegrationClient` and registers itself in
 * `registry.ts`. The registry is the single source the IPC layer talks to, so
 * listing, connecting, testing and disconnecting work identically for every
 * provider — token-based today, OAuth-based when G2 credentials land.
 */

export type IntegrationAuth = 'token' | 'oauth'

export interface IntegrationDescriptor {
  id: IntegrationId
  label: string
  /** `token` = the user pastes a credential; `oauth` = requires an OAuth app (G2, blocked). */
  auth: IntegrationAuth
  /** One line describing what the integration offers. */
  summary: string
}

export interface IntegrationTestResult {
  ok: boolean
  /** Human-readable outcome; must never contain the credential itself. */
  detail: string
  testedAt: string
}

export interface IntegrationClient {
  readonly descriptor: IntegrationDescriptor
  /** Cheap connection state (credential present), no network round-trip. */
  status(): { connected: boolean; detail: string }
  /** Fast read-only call that proves the credential actually works. */
  selfTest(): Promise<IntegrationTestResult>
}

export interface IntegrationState extends IntegrationStatus {
  auth: IntegrationAuth
  summary: string
  /** Last "Test connection" result, if one has been run this session. */
  test: IntegrationTestResult | null
}
