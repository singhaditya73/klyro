import { useEffect, useState } from 'react'
import type {
  AppSettings,
  AutomationCapabilities,
  DataScope,
  DataSummary,
  PermissionState,
  ProviderId,
  ProviderStatus,
  SecurityStatus
} from '@shared/types'
import { useModal } from '../hooks/useModal'
import { Loader2, CheckCircle, AlertCircle, Shield, HardDrive, Trash2, Broom, Database, Key, Zap, X, ExternalLink } from 'lucide-react'
import KlyroMark from '../assets/logo/klyro-mark.svg'

interface Props {
  onClose: () => void
}

function formatBytesLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function SettingsPanel({ onClose }: Props) {
  const panelRef = useModal(onClose)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [permissions, setPermissions] = useState<PermissionState | null>(null)
  const [automation, setAutomation] = useState<AutomationCapabilities | null>(null)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [data, setData] = useState<DataSummary | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [testing, setTesting] = useState<Record<string, string>>({})
  const [keyError, setKeyError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setSettings(await window.klyro.getSettings())
        setProviders(await window.klyro.listProviders())
        setPermissions(await window.klyro.checkPermissions())
        setAutomation(await window.klyro.getAutomationCapabilities())
        setSecurity(await window.klyro.securityStatus())
        setData(await window.klyro.dataSummary())
      } catch (error) {
        setLoadError((error as Error).message)
      }
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
    setKeyError(null)
    try {
      setProviders(await window.klyro.setApiKey(id, draft))
      setKeyDrafts((prev) => ({ ...prev, [id]: '' }))
      setSecurity(await window.klyro.securityStatus())
    } catch (error) {
      setKeyError((error as Error).message)
    }
  }

  async function clearKey(id: ProviderId): Promise<void> {
    setProviders(await window.klyro.clearApiKey(id))
    setSecurity(await window.klyro.securityStatus())
  }

  async function clearScope(scope: DataScope): Promise<void> {
    setData(await window.klyro.dataClear(scope))
  }

  async function sweep(): Promise<void> {
    setData(await window.klyro.sweepStorage())
  }

  async function test(id: ProviderId): Promise<void> {
    setTesting((prev) => ({ ...prev, [id]: 'Testing&hellip;' }))
    try {
      const result = await window.klyro.testProvider(id)
      setTesting((prev) => ({
        ...prev,
        [id]: result.ok
          ? `<CheckCircle /> ${result.detail}${result.latencyMs ? ` (${result.latencyMs} ms)` : ''}`
          : `<AlertCircle /> ${result.detail}`
      }))
    } catch (error) {
      setTesting((prev) => ({ ...prev, [id]: `<AlertCircle /> ${(error as Error).message}` }))
    }
  }

  function renderSections(current: AppSettings): React.ReactNode {
    const settings = current
    return (
      <>
        <section>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Providers</h3>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px' }}>
            Choose a provider, paste your API key, and set a model. Keys are stored encrypted on this device and never sent to the page.
          </p>
          {keyError && <div className="notice notice--error" style={{ marginBottom: '16px' }}><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{keyError}</div>}
          {providers.map((provider) => {
            const config = settings.providers[provider.id]
            return (
              <div key={provider.id} className={`provider-card${settings.activeProvider === provider.id ? ' provider-card--active' : ''}`}>
                <label className="provider-card__head" style={{ cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="active-provider"
                    checked={settings.activeProvider === provider.id}
                    onChange={() => void patch({ activeProvider: provider.id })}
                    style={{ accentColor: 'var(--action-primary-bg)' }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
                    <strong>{provider.label}</strong>
                    {provider.hasKey ? (
                      <span className="pill pill--ok"><CheckCircle className="icon icon--xs" aria-hidden="true" />Key saved</span>
                    ) : provider.requiresKey ? (
                      <span className="pill"><AlertCircle className="icon icon--xs" aria-hidden="true" />No key</span>
                    ) : (
                      <span className="pill"><Shield className="icon icon--xs" aria-hidden="true" />No key needed</span>
                    )}
                  </div>
                </label>

                <div className="provider-card__grid">
                  <label className="field">
                    <span className="field__label">Model</span>
                    <input value={config.model} onChange={(event) => void updateProviderField(provider.id, 'model', event.target.value)} className="field" />
                  </label>
                  <label className="field">
                    <span className="field__label">Base URL</span>
                    <input value={config.baseUrl} onChange={(event) => void updateProviderField(provider.id, 'baseUrl', event.target.value)} className="field" />
                  </label>
                </div>

                {provider.requiresKey && (
                  <div className="provider-card__key" style={{ marginTop: '12px' }}>
                    <input
                      type="password"
                      placeholder="Paste API key&hellip;"
                      value={keyDrafts[provider.id] ?? ''}
                      onChange={(event) => setKeyDrafts((prev) => ({ ...prev, [provider.id]: event.target.value }))}
                      className="field"
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn--primary" onClick={() => void saveKey(provider.id)}>
                        <Key className="icon icon--sm" aria-hidden="true" />
                        <span>Save key</span>
                      </button>
                      <button className="btn btn--ghost" onClick={() => void clearKey(provider.id)}>
                        <Trash2 className="icon icon--sm" aria-hidden="true" />
                        <span>Clear</span>
                      </button>
                    </div>
                  </div>
                )}

                <div className="provider-card__actions">
                  <button className="btn" onClick={() => void test(provider.id)} disabled={testing[provider.id] === 'Testing&hellip;'} aria-label={`Test ${provider.label} connection`}>
                    {testing[provider.id] ? (
                      <>
                        <Loader2 className="icon icon--sm" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" />
                        <span>Testing&hellip;</span>
                      </>
                    ) : (
                      <>
                        <Zap className="icon icon--sm" aria-hidden="true" />
                        <span>Test connection</span>
                      </>
                    )}
                  </button>
                  {testing[provider.id] && <span className="muted" dangerouslySetInnerHTML={{ __html: testing[provider.id] }} />}
                </div>

                {settings.activeProvider === provider.id && provider.vision === 'no' && (
                  <div className="provider-card__warning" style={{ marginTop: '12px' }}>
                    <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    "{config.model || 'This model'}" cannot read images, so the agent cannot run on it. Pick a vision-capable model above.
                  </div>
                )}
              </div>
            )
          })}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Assistant</h3>
          <label className="field" style={{ marginBottom: '16px' }}>
            <span className="field__label">System prompt</span>
            <textarea rows={3} value={settings.systemPrompt} onChange={(event) => void patch({ systemPrompt: event.target.value })} className="field" />
          </label>
          <div className="provider-card__grid" style={{ marginTop: '8px' }}>
            <label className="field">
              <span className="field__label">Response style</span>
              <select value={settings.responseStyle} onChange={(event) => void patch({ responseStyle: event.target.value as AppSettings['responseStyle'] })} className="field">
                <option value="concise">Concise</option>
                <option value="balanced">Balanced</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label className="field">
              <span className="field__label">Theme</span>
              <select value={settings.theme} onChange={(event) => void patch({ theme: event.target.value as AppSettings['theme'] })} className="field">
                <option value="system">System</option>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
          </div>
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Desktop</h3>
          <label className="checkbox">
            <input type="checkbox" checked={settings.launchAtLogin} onChange={(event) => void patch({ launchAtLogin: event.target.checked })} />
            <span>Launch Klyro at login</span>
          </label>
          <label className="field" style={{ marginTop: '16px' }}>
            <span className="field__label">Quick-ask shortcut</span>
            <input value={settings.toggleShortcut} onChange={(event) => void patch({ toggleShortcut: event.target.value })} className="field" />
          </label>

          {permissions && (
            <div className="permissions-section" style={{ marginTop: '16px' }}>
              <h4>Permissions</h4>
              <div className="permissions-section__row">
                <span>Microphone</span>
                <strong>{permissions.microphone}</strong>
              </div>
              <div className="permissions-section__row">
                <span>Screen</span>
                <strong>{permissions.screen}</strong>
              </div>
              <div className="permissions-section__row">
                <span>Accessibility</span>
                <strong>{permissions.accessibility}</strong>
              </div>
              {permissions.notes.map((note, index) => (
                <div key={index} className="muted" style={{ fontSize: '12px' }}>{note}</div>
              ))}
            </div>
          )}

          <h4 style={{ margin: '24px 0 12px', fontSize: '13px', fontWeight: 600 }}>Desktop agent</h4>
          <label className="checkbox">
            <input type="checkbox" checked={settings.agentConfirmConsequential} onChange={(event) => void patch({ agentConfirmConsequential: event.target.checked })} />
            <span>Ask before clicks, typing, and other state-changing actions</span>
          </label>
          <label className="field" style={{ marginTop: '12px' }}>
            <span className="field__label">Max steps per task</span>
            <input type="number" min={1} max={30} value={settings.agentMaxSteps} onChange={(event) => void patch({ agentMaxSteps: Number(event.target.value) || 1 })} className="field" />
          </label>
          {automation && (
            <div className="permissions-section" style={{ marginTop: '16px' }}>
              <h4>Automation backend</h4>
              <div className="permissions-section__row">
                <span>Status</span>
                <strong>{automation.available ? `ready (${automation.backends.join(', ')})` : 'unavailable'}</strong>
              </div>
              {automation.missing.length && <div className="muted" style={{ fontSize: '12px' }}><strong>Missing:</strong> {automation.missing.join(', ')}</div>}
              {automation.installHint && (
                <div className="muted" style={{ fontSize: '12px' }}>
                  Install: <code className="agent-panel__code">{automation.installHint}</code>
                </div>
              )}
              {automation.limitations.map((note, index) => (
                <div key={index} className="muted" style={{ fontSize: '12px' }}>{note}</div>
              ))}
            </div>
          )}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Memory & knowledge</h3>
          <p className="muted" style={{ margin: '0 0 16px', fontSize: '13px', lineHeight: 1.5 }}>
            Everything here is stored locally on this device. Memories and document excerpts relevant to your question are added to the prompt automatically.
          </p>
          <label className="checkbox">
            <input type="checkbox" checked={settings.memoryEnabled} onChange={(event) => void patch({ memoryEnabled: event.target.checked })} />
            <span>Use remembered facts to ground answers</span>
          </label>
          <label className="checkbox" style={{ marginTop: '12px' }}>
            <input type="checkbox" checked={settings.memoryAutoExtract} onChange={(event) => void patch({ memoryAutoExtract: event.target.checked })} />
            <span>Learn durable facts from conversations automatically</span>
          </label>
          <div className="provider-card__grid" style={{ marginTop: '16px' }}>
            <label className="field">
              <span className="field__label">Memories per answer</span>
              <input type="number" min={1} max={20} value={settings.memoryRecallCount} onChange={(event) => void patch({ memoryRecallCount: Number(event.target.value) || 1 })} className="field" />
            </label>
            <label className="field">
              <span className="field__label">Document excerpts per answer</span>
              <input type="number" min={1} max={10} value={settings.documentRecallCount} onChange={(event) => void patch({ documentRecallCount: Number(event.target.value) || 1 })} className="field" />
            </label>
          </div>
          <label className="checkbox" style={{ marginTop: '16px' }}>
            <input type="checkbox" checked={settings.knowledgeEnabled} onChange={(event) => void patch({ knowledgeEnabled: event.target.checked })} />
            <span>Use local documents to ground answers</span>
          </label>
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Security & data</h3>
          {security && (
            <div className="permissions-section" style={{ marginBottom: '24px' }}>
              <h4>
                <Shield className="icon icon--sm" aria-hidden="true" />
                <span style={{ marginLeft: '8px' }}>Credential storage</span>
              </h4>
              <div className="permissions-section__row">
                <span>OS keychain</span>
                <strong>{security.encryptionAvailable ? 'available (keys encrypted)' : 'unavailable'}</strong>
              </div>
              {security.hasPlaintextSecrets && (
                <div className="muted" style={{ fontSize: '12px', marginTop: '8px' }}>
                  Some saved keys are stored unencrypted on disk. Install a keyring (gnome-keyring / kwallet) to protect them, then re-save the key.
                </div>
              )}
              {!security.encryptionAvailable && (
                <label className="checkbox" style={{ marginTop: '12px' }}>
                  <input type="checkbox" checked={settings.allowUnencryptedSecrets} onChange={(event) => void patch({ allowUnencryptedSecrets: event.target.checked })} />
                  <span>Allow storing API keys unencrypted on this device (not recommended)</span>
                </label>
              )}
            </div>
          )}

          {data && (
            <div className="permissions-section" style={{ marginBottom: '24px' }}>
              <h4>
                <Database className="icon icon--sm" aria-hidden="true" />
                <span style={{ marginLeft: '8px' }}>What is stored</span>
              </h4>
              <p className="muted" style={{ margin: '8px 0 16px', fontSize: '12px', lineHeight: 1.5 }}>
                {data.activeProviderIsLocal
                  ? `Your active provider (${data.activeProvider}) runs on this device. Prompts are not sent to a third party.`
                  : `Your active provider (${data.activeProvider}) is a remote service: questions, attachments, and any retrieved excerpts relevant to them are sent to it.`}
              </p>
              <div className="data-row">
                <span>Conversations: {data.conversations}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('conversations')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Memories: {data.memories}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('memory')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Documents: {data.documents}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('documents')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Indexed project files: {data.projectFiles}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('project')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Meetings: {data.meetings}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('meetings')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="data-row">
                <span>Agent task history: {data.agentTasks}</span>
                <button className="btn btn--ghost btn--sm" onClick={() => void clearScope('agentTasks')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
              <div className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
                Saved credentials: {data.credentials}. Credentials are removed from Providers above. Screenshots are captured on demand and never written to disk.
              </div>

              <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--border-subtle)' }}>
                <h4>
                  <HardDrive className="icon icon--sm" aria-hidden="true" />
                  <span style={{ marginLeft: '8px' }}>Storage on this device</span>
                </h4>
                <div className="data-row">
                  <span>
                    Klyro data: {formatBytesLocal(data.storage.dataBytes)} ({data.storage.dataFiles} files)
                    {data.storage.backupFiles > 0 ? ` &middot; edit backups: ${formatBytesLocal(data.storage.backupBytes)}` : ''}
                  </span>
                  <button className="btn btn--ghost btn--sm" onClick={() => void sweep()}>
                    <Broom className="icon icon--xs" aria-hidden="true" />
                    <span>Clean up</span>
                  </button>
                </div>
                {data.storage.lastSweep && (
                  <div className="muted" style={{ marginTop: '12px', fontSize: '12px' }}>
                    Removed {data.storage.lastSweep.removedTempFiles} unfinished write(s) and {data.storage.lastSweep.removedBackups} stale backup(s), freeing {formatBytesLocal(data.storage.lastSweep.freedBytes)}.
                  </div>
                )}
                {data.storage.quarantined.length > 0 && (
                  <div className="notice notice--warning" style={{ marginTop: '12px' }}>
                    <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                    {data.storage.quarantined.length} unreadable data file{data.storage.quarantined.length === 1 ? '' : 's'} kept beside your data (name contains &ldquo;.corrupt-&rdquo;). Klyro started fresh rather than overwriting them.
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        <section style={{ marginTop: '32px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>About</h3>
          <div className="card">
            <div className="card__row">
              <img src={KlyroMark} alt="" style={{ width: 40, height: 40 }} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '15px' }}>Klyro</div>
                <div className="muted" style={{ fontSize: '12px', marginTop: '2px' }}>Your AI. Your entire computer.</div>
                <div className="muted" style={{ fontSize: '11px', marginTop: '4px' }}>Version 0.2.0</div>
              </div>
            </div>
            <div className="card__text muted" style={{ marginTop: '12px', fontSize: '12px', lineHeight: 1.6 }}>
              Klyro is a local-first AI desktop assistant. Your data stays on your device unless you choose to send it to a remote provider.
              <br /><br />
              <ExternalLink className="icon icon--xs" aria-hidden="true" />
              <a href="https://github.com/singhaditya73/klyro" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-secondary)' }}>View on GitHub</a>
            </div>
          </div>
        </section>
      </>
    )
  }

  return (
    <div className="modal">
      <div className="modal__panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1}>
        <div className="modal__head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={KlyroMark} alt="" style={{ width: 24, height: 24 }} aria-hidden="true" />
            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 600 }}>Settings</h2>
          </div>
          <button className="btn btn--icon btn--icon-sm btn--ghost" aria-label="Close settings" onClick={onClose}>
            <X className="icon icon--sm" aria-hidden="true" />
          </button>
        </div>

        <div className="modal__body">
          {loadError ? (
            <div className="notice notice--error"><AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />{loadError}</div>
          ) : settings ? (
            renderSections(settings)
          ) : (
            <div className="muted" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <Loader2 className="icon icon--lg" style={{ animation: 'spin 1s linear infinite', marginBottom: '12px' }} aria-hidden="true" />
              <div>Loading settings&hellip;</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}