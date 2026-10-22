import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Broom,
  CheckCircle2,
  Database,
  HardDrive,
  Key,
  Loader2,
  Shield,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { AppSettings, DataScope, DataSummary, ProviderStatus, SecurityStatus } from '@shared/types'
import { Badge, Group, Hint, PageHeader, SettingRow, StatusDot } from './ui'
import { isLocalProvider } from '../lib/providers'

/**
 * Privacy & data.
 *
 * One page that says where the answers go, what is kept on this machine, and
 * what can be deleted. Every claim here is measured: the keychain is asked,
 * the providers are listed from the settings, the storage report is read from
 * disk, and the capture check takes two real screenshots and compares them.
 */

/** Privacy check: measures whether the overlay is excluded from captures. */
function PrivacyCheckSection(): React.ReactNode {
  const [result, setResult] = useState<{
    excluded: boolean
    changedRatio: number
    platform: string
    supported: boolean
  } | null>(null)
  const [running, setRunning] = useState(false)

  async function run(): Promise<void> {
    setRunning(true)
    try {
      setResult(await window.klyro.privacyProbeOverlay())
    } catch {
      setResult({ excluded: false, changedRatio: 1, platform: 'unknown', supported: false })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Group
      title="Screen-capture exclusion"
      description="Windows and macOS can exclude one window from screen captures and shares. Linux/X11 has no such API — the overlay stays visible in a full-display capture there, and Klyro says so rather than pretending."
      icon={ShieldCheck}
    >
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <button className="btn btn--sm" onClick={() => void run()} disabled={running}>
          {running ? (
            <Loader2 className="icon icon--xs spin" aria-hidden="true" />
          ) : (
            <ShieldCheck className="icon icon--xs" aria-hidden="true" />
          )}
          <span>{running ? 'Checking…' : 'Measure it now'}</span>
        </button>
        <Hint>
          Captures the screen twice — once with the overlay up, once without — and compares the pixels.
        </Hint>
      </div>

      {result && (
        <div className={`notice ${result.excluded ? 'notice--success' : 'notice--warning'}`} style={{ marginTop: 12 }}>
          {result.excluded ? (
            <CheckCircle2 className="icon icon--sm notice__icon" aria-hidden="true" />
          ) : (
            <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          )}
          <div className="notice__body">
            {result.excluded ? (
              <>
                <strong>Verified: the overlay is excluded from screen captures on this machine.</strong>
                <div className="hint" style={{ marginTop: 2 }}>
                  Only {Math.round(result.changedRatio * 100)}% of the overlay&rsquo;s area changed between the two
                  captures — that is screen noise, not the overlay. A full-screen share will not show it.
                </div>
              </>
            ) : result.supported ? (
              <>
                <strong>Not excluded on this platform.</strong>
                <div className="hint" style={{ marginTop: 2 }}>
                  {Math.round(result.changedRatio * 100)}% of the overlay&rsquo;s area is present in the capture, so a
                  full-screen share would show it. Windows and macOS can exclude a window from captures; Linux/X11 has
                  no such API.
                </div>
              </>
            ) : (
              <>
                <strong>Could not run the check.</strong>
                <div className="hint" style={{ marginTop: 2 }}>
                  The overlay window was not available yet. Open the quick-ask overlay once, then run the check again.
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Group>
  )
}

/**
 * Whether this platform can exclude one window from captures.
 *
 * Windows and macOS can; Linux/X11 has no such API, so the overlay stays
 * visible in a full-display capture there.
 */
function captureExclusionSupported(): boolean {
  const platform = navigator.platform
  return /Win/i.test(platform) || /Mac/i.test(platform)
}

function formatBytesLocal(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function PrivacyView(): React.ReactNode {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [data, setData] = useState<DataSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** Each part is loaded on its own: one failure must not empty the page. */
  const load = useCallback(async (): Promise<void> => {
    const failures: string[] = []
    const loaded = await window.klyro.getSettings().catch((caught) => {
      failures.push(`settings: ${(caught as Error).message}`)
      return null
    })
    if (loaded) setSettings(loaded)
    setProviders(
      await window.klyro.listProviders().catch((caught) => {
        failures.push(`providers: ${(caught as Error).message}`)
        return [] as ProviderStatus[]
      })
    )
    setSecurity(
      await window.klyro.securityStatus().catch((caught) => {
        failures.push(`credential storage: ${(caught as Error).message}`)
        return null
      })
    )
    setData(
      await window.klyro.dataSummary().catch((caught) => {
        failures.push(`what is stored: ${(caught as Error).message}`)
        return null
      })
    )
    setError(failures.length > 0 ? failures.join(' · ') : null)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
    setSettings(await window.klyro.updateSettings(next))
  }, [])

  async function clearScope(scope: DataScope): Promise<void> {
    setData(await window.klyro.dataClear(scope))
  }

  async function sweep(): Promise<void> {
    setData(await window.klyro.sweepStorage())
  }

  if (error) {
    return (
      <>
        <PageHeader title="Privacy & Data" icon={Shield} />
        <div className="notice notice--error">
          <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
          {error}
        </div>
      </>
    )
  }

  const active = providers.find((provider) => provider.id === settings?.activeProvider)
  const activeLocal = active ? isLocalProvider(active.id) : false
  const hosted = providers.filter((provider) => !isLocalProvider(provider.id))
  const local = providers.filter((provider) => isLocalProvider(provider.id))

  return (
    <>
      <PageHeader
        title="Privacy & Data"
        description="Where your questions go, what stays on this machine, and how to take it back."
        icon={Shield}
      />

      <Group
        title="Where your answers go"
        description="The provider in use decides it. A local provider never sends anything off the machine."
        icon={Database}
      >
        <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
          <StatusDot state={activeLocal ? 'ok' : 'warn'} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="card__title">
              {active ? active.label : 'No provider selected'}
              {active && <Badge tone={activeLocal ? 'ok' : 'warn'}>{activeLocal ? 'On this machine' : 'Remote service'}</Badge>}
            </div>
            <div className="card__subtitle">
              {active
                ? activeLocal
                  ? 'Questions, pictures and retrieved excerpts stay here. Nothing is sent to a third party.'
                  : 'Questions, pictures and the excerpts that matter are sent to this provider over the network. Nothing is stored on this machine beyond your own history.'
                : 'Connect a provider to answer questions.'}
            </div>
          </div>
        </div>

        <div className="list" style={{ marginTop: 16, border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {local.map((provider) => (
            <div key={provider.id} className="list__row">
              <div className="list__main">
                <div className="list__title">{provider.label}</div>
                <div className="list__meta">Runs on this machine</div>
              </div>
              <Badge tone="ok">Local</Badge>
            </div>
          ))}
          {hosted.map((provider) => (
            <div key={provider.id} className="list__row">
              <div className="list__main">
                <div className="list__title">{provider.label}</div>
                <div className="list__meta">Remote service</div>
              </div>
              <Badge tone="warn">Hosted</Badge>
            </div>
          ))}
        </div>
      </Group>

      <Group
        title="What is stored on this device"
        description="Counts, and one click to remove each kind. Screenshots are captured on demand and never written to disk."
        icon={HardDrive}
      >
        {data ? (
          <div className="list" style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div className="list__row">
              <div className="list__main">
                <div className="list__title">Conversations</div>
                <div className="list__meta">Questions and answers from the overlay</div>
              </div>
              <div className="list__actions">
                <Badge>{data.conversations}</Badge>
                <button className="btn btn--quiet btn--sm" onClick={() => void clearScope('conversations')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
            <div className="list__row">
              <div className="list__main">
                <div className="list__title">Memories</div>
                <div className="list__meta">Facts Klyro was told to keep</div>
              </div>
              <div className="list__actions">
                <Badge>{data.memories}</Badge>
                <button className="btn btn--quiet btn--sm" onClick={() => void clearScope('memory')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
            <div className="list__row">
              <div className="list__main">
                <div className="list__title">Documents</div>
                <div className="list__meta">Indexed files and their excerpts</div>
              </div>
              <div className="list__actions">
                <Badge>{data.documents}</Badge>
                <button className="btn btn--quiet btn--sm" onClick={() => void clearScope('documents')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
            <div className="list__row">
              <div className="list__main">
                <div className="list__title">Interview sessions</div>
                <div className="list__meta">
                  {data.ephemeralInterviews > 0
                    ? `${data.ephemeralInterviews} session(s) are held in memory only and are not on disk`
                    : 'Transcripts, answers and notes'}
                </div>
              </div>
              <div className="list__actions">
                <Badge>{data.interviews}</Badge>
                <button className="btn btn--quiet btn--sm" onClick={() => void clearScope('meetings')}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                  <span>Clear</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <Hint>Reading what is stored…</Hint>
        )}
        <Hint style={{ marginTop: 10 }}>
          Saved credentials: {data?.credentials ?? 0}. Credentials are removed on the Models & Agents page.
        </Hint>
      </Group>

      <Group
        title="Credential storage"
        description="API keys are held by the operating system's keychain. Klyro refuses to write them in plain text unless you say so."
        icon={Key}
      >
        {security && (
          <>
            <SettingRow label="OS keychain" hint="Encryption available through the system keychain or credential store.">
              <Badge tone={security.encryptionAvailable ? 'ok' : 'warn'}>
                {security.encryptionAvailable ? 'Available' : 'Unavailable'}
              </Badge>
            </SettingRow>
            {security.hasPlaintextSecrets && (
              <div className="notice notice--warning" style={{ marginTop: 12 }}>
                <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                <span className="notice__body">
                  Some saved keys are stored unencrypted on disk. Install a keyring (gnome-keyring / kwallet) to protect
                  them, then re-save the key.
                </span>
              </div>
            )}
            {!security.encryptionAvailable && settings && (
              <SettingRow
                label="Allow storing API keys unencrypted"
                hint="Only for a machine with no keychain at all. Anyone with this account can read the keys."
              >
                <input
                  type="checkbox"
                  checked={settings.allowUnencryptedSecrets}
                  onChange={(event) => void patch({ allowUnencryptedSecrets: event.target.checked })}
                />
              </SettingRow>
            )}
          </>
        )}
      </Group>

      {settings && (
        <Group
          title="History & private sessions"
          description="One window covers everything Klyro wrote in words. The usage ledger counts requests only — no words, no timestamps."
          icon={Database}
        >
          <SettingRow
            label="Keep history for"
            hint="Applied at startup and the moment the window changes. Older entries are pruned."
            stacked
          >
            <select value={settings.retentionDays} onChange={(event) => void patch({ retentionDays: Number(event.target.value) })}>
              <option value={0}>Until I delete it</option>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
              <option value={365}>1 year</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Don't keep new interviews"
            hint="An ephemeral session is held in memory: not in the history, not in the answer cache, not in the memory extractor. It is gone when Klyro quits."
          >
            <input
              type="checkbox"
              checked={settings.interviewEphemeralDefault}
              onChange={(event) => void patch({ interviewEphemeralDefault: event.target.checked })}
            />
          </SettingRow>
          <SettingRow
            label="Private mode for the overlay"
            hint={
              captureExclusionSupported()
                ? 'Excludes the overlay from screen captures and shares on this platform.'
                : 'Not supported on Linux/X11: there is no per-window capture exclusion, so a full-display capture still shows the overlay.'
            }
          >
            <input
              type="checkbox"
              checked={settings.overlayPrivateMode}
              onChange={(event) => void patch({ overlayPrivateMode: event.target.checked })}
            />
          </SettingRow>
        </Group>
      )}

      <PrivacyCheckSection />

      <Group
        title="Storage on this device"
        description="How much Klyro is keeping, and a clean-up for the leftovers."
        icon={HardDrive}
      >
        {data && (
          <>
            <div className="row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div className="card__title">
                  {formatBytesLocal(data.storage.dataBytes)} in {data.storage.dataFiles} file
                  {data.storage.dataFiles === 1 ? '' : 's'}
                </div>
                <div className="card__subtitle">
                  {data.storage.backupFiles > 0
                    ? `Plus ${formatBytesLocal(data.storage.backupBytes)} of edit backups.`
                    : 'No edit backups.'}
                </div>
              </div>
              <button className="btn btn--sm" onClick={() => void sweep()}>
                <Broom className="icon icon--xs" aria-hidden="true" />
                <span>Clean up</span>
              </button>
            </div>
            {data.storage.lastSweep && (
              <Hint style={{ marginTop: 10 }}>
                Removed {data.storage.lastSweep.removedTempFiles} unfinished write(s) and{' '}
                {data.storage.lastSweep.removedBackups} stale backup(s), freeing{' '}
                {formatBytesLocal(data.storage.lastSweep.freedBytes)}.
              </Hint>
            )}
            {data.storage.quarantined.length > 0 && (
              <div className="notice notice--warning" style={{ marginTop: 12 }}>
                <AlertCircle className="icon icon--sm notice__icon" aria-hidden="true" />
                <span className="notice__body">
                  {data.storage.quarantined.length} unreadable data file
                  {data.storage.quarantined.length === 1 ? '' : 's'} kept beside your data (name contains &ldquo;.corrupt-&rdquo;).
                  Klyro started fresh rather than overwriting them.
                </span>
              </div>
            )}
          </>
        )}
      </Group>
    </>
  )
}
