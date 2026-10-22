import { useCallback, useEffect, useMemo, useState } from 'react'
import { Bot, Cloud, Cpu, Server, Sparkles } from 'lucide-react'
import type { AppSettings, ProviderId, ProviderStatus } from '@shared/types'
import { Badge, Group, PageHeader, StatusDot } from './ui'
import { ProviderCard } from './ProviderCard'
import { LocalAgentsSection, type CliAgent, type LocalAgent } from './LocalAgentsSection'
import { AGENT_PROVIDERS, HOSTED_PROVIDERS, LOCAL_PROVIDERS, providerState } from '../lib/providers'
import { useProviderHealth } from '../hooks/useProviderHealth'
import type { Route } from '../hooks/useHashRoute'

/**
 * Models & agents.
 *
 * Everything here is something the user already has: a hosted key, a local
 * server, an agent CLI. Connecting one of them is a click, and the account it
 * uses is their own — no key to paste for a local agent, no new subscription.
 *
 * The three groups answer three different questions: what runs on someone
 * else's servers, what runs on this machine, and what is a program Klyro can
 * start.
 */

export function ModelsView({ onNavigate }: { onNavigate: (route: Route) => void }): React.ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [agents, setAgents] = useState<LocalAgent[]>([])
  const [clis, setClis] = useState<CliAgent[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async (): Promise<void> => {
    try {
      const [next, list, local, programs] = await Promise.all([
        window.klyro.getSettings(),
        window.klyro.listProviders(),
        window.klyro.localAgentsDetect(),
        window.klyro.localAgentClis()
      ])
      setSettings(next)
      setProviders(list)
      setAgents(local)
      setClis(programs)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
    const updated = await window.klyro.updateSettings(next)
    setSettings(updated)
  }, [])

  const patchProvider = useCallback(
    async (id: ProviderId, field: 'baseUrl' | 'model' | 'fastModel', value: string): Promise<void> => {
      if (!settings) return
      const current = settings.providers[id]
      await patch({ providers: { ...settings.providers, [id]: { ...current, [field]: value } } })
    },
    [patch, settings]
  )

  /** Point Klyro at a service that is already running on this machine. */
  const connectLocalAgent = useCallback(
    async (agent: LocalAgent, model: string): Promise<void> => {
      try {
        const providerId: ProviderId = agent.kind === 'opencode' ? 'opencode' : 'openai-compatible'
        let chosen = model || agent.models[0] || ''
        // A catalogue entry is not a promise: an OpenCode provider can be signed
        // out or out of credit, and then its turns never start. Ask one that
        // answers before saving it, so a fresh connection is not a dead one.
        let check: { verified: boolean; name: string; tried: number } | null = null
        if (agent.kind === 'opencode') {
          setNotice(`Checking which ${agent.name} model answers…`)
          try {
            const picked = await window.klyro.openCodePickModel(agent.baseUrl)
            if (picked.model) {
              chosen = picked.model
              check = { verified: picked.verified, name: picked.name, tried: picked.tried.length }
            }
          } catch {
            // Keep the catalogue's first model; the chip can change it.
          }
        }
        const current = await window.klyro.getSettings()
        await window.klyro.updateSettings({
          ...current,
          activeProvider: providerId,
          providers: {
            ...current.providers,
            [providerId]: {
              ...current.providers[providerId],
              baseUrl: agent.baseUrl,
              model: chosen
            }
          }
        })
        setSettings(await window.klyro.getSettings())
        if (check?.verified) {
          setNotice(`${agent.name} is now your provider (${check.name}), checked and answering.`)
        } else if (check && check.tried > 0) {
          setNotice(
            `${agent.name} is connected, but no free model answered a check question. Pick one with the model chip in the overlay.`
          )
        } else if (check) {
          setNotice(`${agent.name} is connected. Pick the model you want with the model chip in the overlay.`)
        } else {
          setNotice(`${agent.name} is now your provider${chosen ? ` (${chosen})` : ''}. No key needed.`)
        }
      } catch (error) {
        setNotice((error as Error).message)
      }
    },
    []
  )

  const baseUrls = useMemo(() => {
    const map: Partial<Record<ProviderId, string>> = {}
    for (const [id, provider] of Object.entries(settings?.providers ?? {})) {
      map[id as ProviderId] = provider?.baseUrl ?? ''
    }
    return map
  }, [settings])
  const { health } = useProviderHealth(baseUrls)

  const byId = (id: ProviderId): ProviderStatus | undefined => providers.find((p) => p.id === id)
  const hosted = HOSTED_PROVIDERS.map(byId).filter((p): p is ProviderStatus => Boolean(p))
  const local = LOCAL_PROVIDERS.map(byId).filter((p): p is ProviderStatus => Boolean(p))
  const agentProviders = AGENT_PROVIDERS.map(byId).filter((p): p is ProviderStatus => Boolean(p))

  const card = (provider: ProviderStatus): React.ReactNode =>
    settings ? (
      <ProviderCard
        key={provider.id}
        provider={provider}
        settings={settings}
        agents={agents}
        clis={clis}
        health={health[provider.id]}
        onSettings={patch}
        onProviderField={patchProvider}
        onSaved={() => void load()}
      />
    ) : null

  return (
    <>
      <PageHeader
        title="Models & Agents"
        description="The models and agents you already have, with their own sign-in. A hosted key, a local server, or an agent CLI — nothing else to buy."
        icon={Cpu}
      />

      {notice && (
        <div className="notice notice--info" style={{ marginBottom: 16 }}>
          <span className="notice__body">{notice}</span>
        </div>
      )}

      {loading && !settings ? (
        <div className="loading-line">Loading your providers…</div>
      ) : (
        <>
          <Group
            title="Hosted providers"
            description="Your key, your account, their servers. Questions, pictures and the excerpts that matter travel to them."
            icon={Cloud}
          >
            <div className="stack">
              {hosted.map((provider) => card(provider))}
            </div>
          </Group>

          <Group
            title="Local model servers"
            description="Runs on this machine. Nothing you ask leaves it."
            icon={Server}
          >
            <div className="stack" style={{ marginBottom: 16 }}>
              {local.map((provider) => card(provider))}
            </div>
            <LocalAgentsSection
              title="Found on this machine"
              description="OpenCode, Ollama, LM Studio, LiteLLM and vLLM, found by scanning the usual ports."
              onConnect={(agent, model) => void connectLocalAgent(agent, model)}
              onOpenSettings={() => onNavigate('settings')}
              show={{ antigravity: false, clis: false }}
            />
          </Group>

          <Group
            title="Coding agents"
            description="Programs on this machine. They use the sign-in you already have, and they can read the screen."
            icon={Bot}
          >
            <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden', marginBottom: 12 }}>
              {agentProviders.map((provider) => {
                const state = providerState(provider, agents, clis, health[provider.id])
                const isActive = settings?.activeProvider === provider.id
                return (
                  <div key={provider.id} className="list__row">
                    <StatusDot state={state.tone === 'ok' ? 'ok' : 'idle'} title={state.label} />
                    <div className="list__main">
                      <div className="list__title">
                        {provider.label}
                        {isActive && <Badge tone="accent">In use</Badge>}
                      </div>
                      <div className="list__meta">
                        {provider.id === 'antigravity'
                          ? 'Antigravity’s own models, through the IDE or the agent service.'
                          : state.label}
                      </div>
                    </div>
                    <div className="list__actions">
                      {provider.id !== 'antigravity' && (
                        <button
                          className="btn btn--sm"
                          onClick={() => void patch({ activeProvider: provider.id })}
                          disabled={isActive}
                        >
                          <Sparkles className="icon icon--xs" aria-hidden="true" />
                          <span>{isActive ? 'In use' : 'Use this'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
            <LocalAgentsSection
              title="Antigravity"
              description="Connect your account once; after that the IDE never has to be open again."
              onConnect={(agent, model) => void connectLocalAgent(agent, model)}
              onOpenSettings={() => onNavigate('settings')}
              show={{ detected: false, opencode: false, clis: false }}
            />
          </Group>
        </>
      )}
    </>
  )
}
