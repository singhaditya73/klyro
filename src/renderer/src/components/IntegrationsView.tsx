import { useState } from 'react'
import { CheckCircle } from 'lucide-react'
import { LocalAgentsSection } from './LocalAgentsSection'
import KlyroMark from '../assets/logo/klyro-mark.svg'

/**
 * The models and agents you can use.
 *
 * Everything here is something the user already has: a local server, an agent
 * CLI, or the Antigravity IDE. Connecting one of them is a click, and the
 * account they use is their own — no key, no copy-paste, no new subscription.
 */

interface Props {
  onOpenSettings?: () => void
}

export function IntegrationsView({ onOpenSettings }: Props) {
  const [notice, setNotice] = useState<string | null>(null)

  /** Point Klyro at a service that is already running on this machine. */
  async function connectLocalAgent(
    agent: { id: string; kind: 'opencode' | 'openai-compatible'; name: string; baseUrl: string; models: string[] },
    model: string
  ): Promise<void> {
    try {
      const settings = await window.klyro.getSettings()
      const providerId = agent.kind === 'opencode' ? 'opencode' : 'openai-compatible'
      await window.klyro.updateSettings({
        ...settings,
        activeProvider: providerId,
        providers: {
          ...settings.providers,
          [providerId]: {
            ...settings.providers[providerId],
            baseUrl: agent.baseUrl,
            model: model || agent.models[0] || ''
          }
        }
      })
      setNotice(`${agent.name} is now your provider${model ? ` (${model})` : ''}. No key needed.`)
    } catch (error) {
      setNotice((error as Error).message)
    }
  }

  return (
    <div className="workspace" style={{ padding: '32px 36px 60px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <img src={KlyroMark} alt="" width={26} height={26} aria-hidden="true" />
        <div>
          <h1 style={{ margin: 0, fontSize: 19, fontWeight: 650 }}>Models &amp; agents</h1>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 13 }}>
            The models and agents you already have, with their own sign-in. No key to paste.
          </p>
        </div>
      </header>

      <LocalAgentsSection
        onConnect={(agent, model) => void connectLocalAgent(agent, model)}
        onOpenSettings={onOpenSettings}
      />
      {notice && (
        <div className="notice notice--success" style={{ marginTop: 12 }}>
          <span className="icon icon--sm notice__icon" aria-hidden="true">
            <CheckCircle />
          </span>
          <span className="notice__body">{notice}</span>
        </div>
      )}
    </div>
  )
}
