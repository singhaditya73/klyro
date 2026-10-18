import { useEffect, useState } from 'react'
import type { AppSettings, AutomationCapabilities, PermissionState, ProviderId, ProviderStatus } from '@shared/types'

interface Props {
  onClose: () => void
}

export function SettingsPanel({ onClose }: Props) {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [permissions, setPermissions] = useState<PermissionState | null>(null)
  const [automation, setAutomation] = useState<AutomationCapabilities | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<Record<string, string>>({})

  useEffect(() => {
    void (async () => {
      setSettings(await window.klyro.getSettings())
      setProviders(await window.klyro.listProviders())
      setPermissions(await window.klyro.checkPermissions())
      setAutomation(await window.klyro.getAutomationCapabilities())
    })()
  }, [])

  async function patch(next: Partial<AppSettings>): Promise<void> {
    setSettings(await window.klyro.updateSettings(next))
  }

  async function updateProviderField(id: ProviderId, field: 'baseUrl' | 'model', value: string): Promise<void> {
    if (!settings) return
    const current = settings.providers[id]
    await patch({ providers: { ...settings.providers, [id]: { ...current, [field]: value } } })
  }

  async function saveKey(id: ProviderId): Promise<void> {
    const draft = keyDrafts[id]
    if (draft === undefined) return
    setProviders(await window.klyro.setApiKey(id, draft))
    setKeyDrafts((prev) => ({ ...prev, [id]: '' }))
  }

  async function clearKey(id: ProviderId): Promise<void> {
    setProviders(await window.klyro.clearApiKey(id))
  }

  async function test(id: ProviderId): Promise<void> {
    setTesting((prev) => ({ ...prev, [id]: 'Testing…' }))
    try {
      const result = await window.klyro.testProvider(id)
      setTesting((prev) => ({
        ...prev,
        [id]: result.ok
          ? `✓ ${result.detail}${result.latencyMs ? ` (${result.latencyMs} ms)` : ''}`
          : `✗ ${result.detail}`
      }))
    } catch (error) {
      setTesting((prev) => ({ ...prev, [id]: `✗ ${(error as Error).message}` }))
    }
  }

  if (!settings) return null

  return (
    <div className="modal">
      <div className="modal__panel">
        <div className="modal__head">
          <h2>Settings</h2>
          <button className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="modal__body">
          <section>
            <h3>Providers</h3>
            <p className="muted">
              Choose a provider, paste your API key, and set a model. Keys are stored encrypted on this device and
              never sent to the page.
            </p>
            {providers.map((provider) => {
              const config = settings.providers[provider.id]
              return (
                <div
                  key={provider.id}
                  className={`provider${settings.activeProvider === provider.id ? ' provider--active' : ''}`}
                >
                  <label className="provider__head">
                    <input
                      type="radio"
                      name="active-provider"
                      checked={settings.activeProvider === provider.id}
                      onChange={() => void patch({ activeProvider: provider.id })}
                    />
                    <strong>{provider.label}</strong>
                    {provider.hasKey ? (
                      <span className="pill pill--ok">key saved</span>
                    ) : provider.requiresKey ? (
                      <span className="pill">no key</span>
                    ) : (
                      <span className="pill">no key needed</span>
                    )}
                  </label>

                  <div className="provider__grid">
                    <label>
                      Model
                      <input
                        value={config.model}
                        onChange={(event) => void updateProviderField(provider.id, 'model', event.target.value)}
                      />
                    </label>
                    <label>
                      Base URL
                      <input
                        value={config.baseUrl}
                        onChange={(event) => void updateProviderField(provider.id, 'baseUrl', event.target.value)}
                      />
                    </label>
                  </div>

                  {provider.requiresKey ? (
                    <div className="provider__key">
                      <input
                        type="password"
                        placeholder="Paste API key…"
                        value={keyDrafts[provider.id] ?? ''}
                        onChange={(event) =>
                          setKeyDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))
                        }
                      />
                      <button className="btn" onClick={() => void saveKey(provider.id)}>
                        Save key
                      </button>
                      <button className="btn btn--ghost" onClick={() => void clearKey(provider.id)}>
                        Clear
                      </button>
                    </div>
                  ) : null}

                  <div className="provider__actions">
                    <button className="btn" onClick={() => void test(provider.id)}>
                      Test connection
                    </button>
                    {testing[provider.id] ? <span className="muted">{testing[provider.id]}</span> : null}
                  </div>
                </div>
              )
            })}
          </section>

          <section>
            <h3>Assistant</h3>
            <label className="field">
              System prompt
              <textarea
                rows={3}
                value={settings.systemPrompt}
                onChange={(event) => void patch({ systemPrompt: event.target.value })}
              />
            </label>
            <div className="provider__grid">
              <label>
                Response style
                <select
                  value={settings.responseStyle}
                  onChange={(event) => void patch({ responseStyle: event.target.value as AppSettings['responseStyle'] })}
                >
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="detailed">Detailed</option>
                </select>
              </label>
              <label>
                Theme
                <select
                  value={settings.theme}
                  onChange={(event) => void patch({ theme: event.target.value as AppSettings['theme'] })}
                >
                  <option value="system">System</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
            </div>
          </section>

          <section>
            <h3>Desktop</h3>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.launchAtLogin}
                onChange={(event) => void patch({ launchAtLogin: event.target.checked })}
              />
              Launch Klyro at login
            </label>
            <label className="field">
              Quick-ask shortcut
              <input
                value={settings.toggleShortcut}
                onChange={(event) => void patch({ toggleShortcut: event.target.value })}
              />
            </label>

            {permissions ? (
              <div className="permissions">
                <h4>Permissions</h4>
                <div>
                  Microphone: <strong>{permissions.microphone}</strong>
                </div>
                <div>
                  Screen: <strong>{permissions.screen}</strong>
                </div>
                <div>
                  Accessibility: <strong>{permissions.accessibility}</strong>
                </div>
                {permissions.notes.map((note, index) => (
                  <div key={index} className="muted">
                    {note}
                  </div>
                ))}
              </div>
            ) : null}

            <h4>Desktop agent</h4>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.agentConfirmConsequential}
                onChange={(event) => void patch({ agentConfirmConsequential: event.target.checked })}
              />
              Ask before clicks, typing, and other state-changing actions
            </label>
            <label className="field">
              Max steps per task
              <input
                type="number"
                min={1}
                max={30}
                value={settings.agentMaxSteps}
                onChange={(event) => void patch({ agentMaxSteps: Number(event.target.value) || 1 })}
              />
            </label>
            {automation ? (
              <div className="permissions">
                <h4>Automation backend</h4>
                <div>
                  Status:{' '}
                  <strong>{automation.available ? `ready (${automation.backends.join(', ')})` : 'unavailable'}</strong>
                </div>
                {automation.missing.length ? <div className="muted">Missing: {automation.missing.join(', ')}</div> : null}
                {automation.installHint ? (
                  <div className="muted">
                    Install: <code>{automation.installHint}</code>
                  </div>
                ) : null}
                {automation.limitations.map((note, index) => (
                  <div key={index} className="muted">
                    {note}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <h3>Memory &amp; knowledge</h3>
            <p className="muted">
              Everything here is stored locally on this device. Memories and document excerpts relevant to your
              question are added to the prompt automatically.
            </p>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.memoryEnabled}
                onChange={(event) => void patch({ memoryEnabled: event.target.checked })}
              />
              Use remembered facts to ground answers
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.memoryAutoExtract}
                onChange={(event) => void patch({ memoryAutoExtract: event.target.checked })}
              />
              Learn durable facts from conversations automatically
            </label>
            <div className="provider__grid">
              <label>
                Memories per answer
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={settings.memoryRecallCount}
                  onChange={(event) => void patch({ memoryRecallCount: Number(event.target.value) || 1 })}
                />
              </label>
              <label>
                Document excerpts per answer
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={settings.documentRecallCount}
                  onChange={(event) => void patch({ documentRecallCount: Number(event.target.value) || 1 })}
                />
              </label>
            </div>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={settings.knowledgeEnabled}
                onChange={(event) => void patch({ knowledgeEnabled: event.target.checked })}
              />
              Use local documents to ground answers
            </label>
          </section>
        </div>
      </div>
    </div>
  )
}
