import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  Blocks,
  Briefcase,
  Check,
  CheckCircle2,
  Database,
  GitBranch,
  HardDrive,
  Info,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Save,
  Send,
  Server,
  Share2,
  Trash2
} from 'lucide-react'
import { Badge, EmptyState, Group, PageHeader } from './ui'
import type { DirectIntegrations, MCPServerState } from '@shared/types'

const PRESET_MCP_SERVERS = [
  {
    name: 'Slack MCP Server',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-slack'],
    description: 'Post meeting summaries, thread updates, and action items directly to Slack channels.',
    icon: Share2
  },
  {
    name: 'GitHub MCP Server',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    description: 'Create pull requests, file repository issues from meeting deliverables, and review code.',
    icon: GitBranch
  },
  {
    name: 'Google Drive & Docs MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-gdrive'],
    description: 'Search corporate Google Drive documents and sync meeting notes directly into Google Docs.',
    icon: HardDrive
  },
  {
    name: 'PostgreSQL Database MCP',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres'],
    description: 'Live read-only access to company databases to answer client technical questions on calls.',
    icon: Database
  }
]

export function IntegrationsView(): React.ReactNode {
  const [integrations, setIntegrations] = useState<DirectIntegrations>({
    slackWebhookUrl: '',
    crmWebhookUrl: '',
    crmType: 'hubspot',
    gmailRecipient: '',
    notionToken: '',
    linearApiKey: ''
  })
  const [servers, setServers] = useState<MCPServerState[]>([])
  const [activeTab, setActiveTab] = useState<'integrations' | 'mcp'>('integrations')

  // Custom MCP form state
  const [showAddModal, setShowAddModal] = useState(false)
  const [serverName, setServerName] = useState('')
  const [serverCommand, setServerCommand] = useState('npx')
  const [serverArgs, setServerArgs] = useState('-y @modelcontextprotocol/server-')
  const [serverEnv, setServerEnv] = useState('')

  // Dispatch feedback state
  const [testingSlack, setTestingSlack] = useState(false)
  const [slackFeedback, setSlackFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [testingCrm, setTestingCrm] = useState(false)
  const [crmFeedback, setCrmFeedback] = useState<{ ok: boolean; msg: string } | null>(null)
  const [savingDirect, setSavingDirect] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [testingMcpId, setTestingMcpId] = useState<string | null>(null)
  const [mcpTestResult, setMcpTestResult] = useState<Record<string, string>>({})

  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [intConfig, mcpList] = await Promise.all([
        window.klyro.integrationsGet(),
        window.klyro.mcpServers()
      ])
      if (intConfig) setIntegrations(intConfig)
      if (mcpList) setServers(mcpList)
    } catch (err) {
      console.error('Failed to load integrations', err)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleSaveIntegrations = async (): Promise<void> => {
    setSavingDirect(true)
    setSaveError(null)
    try {
      await window.klyro.integrationsUpdate(integrations)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2500)
    } catch (err) {
      // The encrypted store refuses to write plaintext when no keychain is
      // available; show that instead of failing silently.
      setSaveError((err as Error).message)
    } finally {
      setSavingDirect(false)
    }
  }

  const handleTestSlack = async (): Promise<void> => {
    setTestingSlack(true)
    setSlackFeedback(null)
    try {
      const result = await window.klyro.integrationsSendSlack({
        message: '👋 Hello from Klyro! Your Slack direct webhook integration is working perfectly.',
        webhookUrl: integrations.slackWebhookUrl
      })
      if (result.ok) {
        setSlackFeedback({ ok: true, msg: 'Test message sent to Slack successfully!' })
      } else {
        setSlackFeedback({ ok: false, msg: result.error || 'Failed to send to Slack webhook' })
      }
    } catch (err) {
      setSlackFeedback({ ok: false, msg: (err as Error).message })
    } finally {
      setTestingSlack(false)
    }
  }

  const handleTestCrm = async (): Promise<void> => {
    setTestingCrm(true)
    setCrmFeedback(null)
    try {
      const result = await window.klyro.integrationsSendCrm({
        payload: {
          event: 'klyro_test_call_log',
          title: 'Test Deal Sync',
          stage: 'Evaluation',
          summary: 'Klyro direct CRM webhook verified.',
          timestamp: Date.now()
        },
        webhookUrl: integrations.crmWebhookUrl
      })
      if (result.ok) {
        setCrmFeedback({ ok: true, msg: 'Test payload received by CRM endpoint!' })
      } else {
        setCrmFeedback({ ok: false, msg: result.error || 'Failed to dispatch to CRM webhook' })
      }
    } catch (err) {
      setCrmFeedback({ ok: false, msg: (err as Error).message })
    } finally {
      setTestingCrm(false)
    }
  }

  const handleAddCustomMcp = async (): Promise<void> => {
    if (!serverName.trim() || !serverCommand.trim()) return
    const argsArray = serverArgs.trim().split(/\s+/).filter(Boolean)
    const envObj: Record<string, string> = {}
    if (serverEnv.trim()) {
      serverEnv.split('\n').forEach((line) => {
        const [k, v] = line.split('=')
        if (k && v) envObj[k.trim()] = v.trim()
      })
    }
    await window.klyro.mcpAddServer({
      name: serverName.trim(),
      command: serverCommand.trim(),
      args: argsArray,
      env: Object.keys(envObj).length > 0 ? envObj : undefined
    })
    setShowAddModal(false)
    setServerName('')
    setServerArgs('')
    setServerEnv('')
    await loadData()
  }

  const handleAddPresetMcp = async (preset: (typeof PRESET_MCP_SERVERS)[0]): Promise<void> => {
    await window.klyro.mcpAddServer({
      name: preset.name,
      command: preset.command,
      args: preset.args,
      description: preset.description
    })
    await loadData()
  }

  const handleToggleServer = async (id: string, current: boolean): Promise<void> => {
    await window.klyro.mcpToggleServer(id, !current)
    await loadData()
  }

  const handleRemoveServer = async (id: string): Promise<void> => {
    await window.klyro.mcpRemoveServer(id)
    await loadData()
  }

  const handleTestServer = async (id: string): Promise<void> => {
    setTestingMcpId(id)
    try {
      const res = await window.klyro.mcpTestServer(id)
      if (res.ok) {
        setMcpTestResult((prev) => ({ ...prev, [id]: 'Command found — server not started (MCP client not enabled yet)' }))
      } else {
        setMcpTestResult((prev) => ({ ...prev, [id]: `Error: ${res.error}` }))
      }
    } finally {
      setTestingMcpId(null)
    }
  }

  const configuredServersCount = servers.filter((s) => s.enabled).length

  return (
    <>
      <PageHeader
        title="Integrations &amp; MCP"
        description="Push meeting output to Slack or a CRM webhook, and save Model Context Protocol (MCP) server definitions for the MCP client that is still being built."
        icon={Blocks}
      />

      {/* Primary Tabs */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <button
          className={`btn btn--sm ${activeTab === 'integrations' ? 'btn--primary' : 'btn--quiet'}`}
          onClick={() => setActiveTab('integrations')}
        >
          <Share2 className="icon icon--xs" aria-hidden="true" />
          <span>Direct Integrations (Slack, CRM, Gmail)</span>
        </button>
        <button
          className={`btn btn--sm ${activeTab === 'mcp' ? 'btn--primary' : 'btn--quiet'}`}
          onClick={() => setActiveTab('mcp')}
        >
          <Server className="icon icon--xs" aria-hidden="true" />
          <span>MCP Servers Hub</span>
          <span
            style={{
              marginLeft: 6,
              fontSize: 11,
              background: configuredServersCount > 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
              color: 'inherit',
              padding: '1px 6px',
              borderRadius: 999,
              fontWeight: 600
            }}
          >
            {configuredServersCount} configured
          </span>
        </button>
      </div>

      {/* SECTION 1: DIRECT INTEGRATIONS */}
      {activeTab === 'integrations' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          <Group
            title="Meeting &amp; CRM Distribution Channels"
            description="Configure direct webhooks so you can push meeting summaries, action items, and MEDDPIC logs with 1 click."
            icon={Share2}
            actions={
              <button className="btn btn--primary btn--sm" onClick={handleSaveIntegrations} disabled={savingDirect}>
                {savingDirect ? <Loader2 className="icon icon--xs spin" /> : saveSuccess ? <Check className="icon icon--xs" /> : <Save className="icon icon--xs" />}
                <span>{saveSuccess ? 'Saved!' : 'Save Integrations'}</span>
              </button>
            }
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {saveError && (
                <div
                  role="alert"
                  style={{
                    display: 'flex',
                    gap: 8,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'rgba(255, 99, 99, 0.1)',
                    border: '1px solid rgba(255, 99, 99, 0.35)',
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: 'var(--text-primary)'
                  }}
                >
                  <AlertCircle className="icon icon--xs" style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{saveError}</span>
                </div>
              )}

              {/* Slack Integration Card */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: 'rgba(230, 231, 228, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Share2 className="icon icon--sm" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        Slack Incoming Webhook
                      </h4>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Push meeting recaps and deliverables directly to any Slack channel.
                      </span>
                    </div>
                  </div>
                  <Badge tone={integrations.slackWebhookUrl?.trim() ? 'ok' : 'idle'}>
                    {integrations.slackWebhookUrl?.trim() ? 'Configured' : 'Not configured'}
                  </Badge>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="url"
                    placeholder="https://hooks.slack.com/services/T.../B.../..."
                    value={integrations.slackWebhookUrl || ''}
                    onChange={(e) => setIntegrations({ ...integrations, slackWebhookUrl: e.target.value })}
                    style={{
                      flex: 1,
                      fontSize: 13,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-input)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  />
                  <button
                    className="btn btn--quiet btn--sm"
                    onClick={handleTestSlack}
                    disabled={testingSlack || !integrations.slackWebhookUrl?.trim()}
                  >
                    {testingSlack ? <Loader2 className="icon icon--xs spin" /> : <Send className="icon icon--xs" />}
                    <span>Test Dispatch</span>
                  </button>
                </div>

                {slackFeedback && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: slackFeedback.ok ? 'var(--status-ok)' : 'var(--danger)'
                    }}
                  >
                    {slackFeedback.ok ? <CheckCircle2 className="icon icon--xs" /> : <AlertCircle className="icon icon--xs" />}
                    <span>{slackFeedback.msg}</span>
                  </div>
                )}
              </div>

              {/* CRM Webhook Card (Salesforce / HubSpot) */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: 'rgba(230, 231, 228, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Briefcase className="icon icon--sm" style={{ color: 'var(--status-ok)' }} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        CRM Deal Endpoint (HubSpot / Salesforce / Generic)
                      </h4>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Send structured MEDDPIC deal parameters and pain points to your CRM workflow.
                      </span>
                    </div>
                  </div>
                  <Badge tone={integrations.crmWebhookUrl?.trim() ? 'ok' : 'idle'}>
                    {integrations.crmWebhookUrl?.trim() ? 'Configured' : 'Not configured'}
                  </Badge>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <select
                    value={integrations.crmType || 'hubspot'}
                    onChange={(e) => setIntegrations({ ...integrations, crmType: e.target.value as any })}
                    style={{
                      fontSize: 13,
                      padding: '8px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-input)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  >
                    <option value="hubspot">HubSpot</option>
                    <option value="salesforce">Salesforce</option>
                    <option value="generic">Generic Webhook</option>
                  </select>

                  <input
                    type="url"
                    placeholder="https://api.crm-endpoint.com/webhook/deals/..."
                    value={integrations.crmWebhookUrl || ''}
                    onChange={(e) => setIntegrations({ ...integrations, crmWebhookUrl: e.target.value })}
                    style={{
                      flex: 1,
                      fontSize: 13,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-input)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  />

                  <button
                    className="btn btn--quiet btn--sm"
                    onClick={handleTestCrm}
                    disabled={testingCrm || !integrations.crmWebhookUrl?.trim()}
                  >
                    {testingCrm ? <Loader2 className="icon icon--xs spin" /> : <Send className="icon icon--xs" />}
                    <span>Test Deal Sync</span>
                  </button>
                </div>

                {crmFeedback && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 12,
                      color: crmFeedback.ok ? 'var(--status-ok)' : 'var(--danger)'
                    }}
                  >
                    {crmFeedback.ok ? <CheckCircle2 className="icon icon--xs" /> : <AlertCircle className="icon icon--xs" />}
                    <span>{crmFeedback.msg}</span>
                  </div>
                )}
              </div>

              {/* Email / Gmail Card */}
              <div
                style={{
                  padding: 16,
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 6,
                        background: 'rgba(230, 231, 228, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}
                    >
                      <Mail className="icon icon--sm" style={{ color: 'var(--accent)' }} />
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        Default Email Client / Recipient
                      </h4>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Preset recipient or CRM dropbox address (e.g., Salesforce email-to-lead address).
                      </span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input
                    type="email"
                    placeholder="crm-inbox@company.com or executive-assistant@company.com"
                    value={integrations.gmailRecipient || ''}
                    onChange={(e) => setIntegrations({ ...integrations, gmailRecipient: e.target.value })}
                    style={{
                      flex: 1,
                      fontSize: 13,
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--surface-input)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)'
                    }}
                  />
                </div>
              </div>
            </div>
          </Group>
        </motion.div>
      )}

      {/* SECTION 2: MCP SERVERS HUB */}
      {activeTab === 'mcp' && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.15 }}>
          <Group
            title="Model Context Protocol (MCP) Servers"
            description="Run native MCP servers locally to connect Klyro to local code, external databases, and developer tools."
            icon={Server}
            actions={
              <button className="btn btn--primary btn--sm" onClick={() => setShowAddModal(true)}>
                <Plus className="icon icon--xs" />
                <span>Add MCP Server</span>
              </button>
            }
          >
            {/* Informational Banner */}
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-sunken)',
                border: '1px solid var(--border-subtle)',
                marginBottom: 16,
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text-secondary)'
              }}
            >
              <Info className="icon icon--sm" style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: 'var(--text-primary)' }}>Why connect an MCP server?</strong> MCP allows local AI
                models in Klyro to safely execute tools over stdio (e.g. read files, create GitHub issues, query SQL databases, or send messages)
                without requiring API tokens or private keys to leave your machine.
                <br />
                <strong style={{ color: 'var(--text-primary)' }}>Not enabled in this build:</strong> Klyro saves the
                server definitions below, but it does not start or call MCP servers yet. “Check command” only verifies
                that the command exists on this machine.
              </div>
            </div>

            {/* Popular MCP Presets */}
            <div style={{ marginBottom: 20 }}>
              <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                1-Click Popular MCP Servers
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {PRESET_MCP_SERVERS.map((preset) => {
                  const alreadyAdded = servers.some((s) => s.config.name === preset.name)
                  const Icon = preset.icon
                  return (
                    <div
                      key={preset.name}
                      style={{
                        padding: 12,
                        borderRadius: 'var(--radius-sm)',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Icon className="icon icon--xs" style={{ color: 'var(--accent)' }} />
                          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {preset.name}
                          </span>
                        </div>
                        {alreadyAdded ? (
                          <Badge tone="ok">Added</Badge>
                        ) : (
                          <button
                            type="button"
                            className="btn btn--quiet btn--xs"
                            onClick={() => void handleAddPresetMcp(preset)}
                          >
                            <Plus className="icon icon--xs" />
                            <span>Add</span>
                          </button>
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                        {preset.description}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Configured MCP Servers List */}
            <div>
              <h4 style={{ margin: '0 0 10px 0', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                Configured Servers ({servers.length})
              </h4>

              {servers.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title="No MCP servers configured"
                  text="Click “Add MCP Server” or choose one of the presets above to save a definition for the MCP client, which is not enabled yet."
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {servers.map((server) => (
                    <div
                      key={server.config.id}
                      style={{
                        padding: 14,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--surface-raised)',
                        border: '1px solid var(--border-subtle)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: server.enabled ? 'var(--status-ok)' : 'var(--status-idle)'
                            }}
                          />
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {server.config.name}
                          </span>
                          <Badge tone={server.enabled ? 'ok' : 'idle'}>
                            {server.enabled ? 'Configured' : 'Off'}
                          </Badge>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            className="btn btn--quiet btn--xs"
                            onClick={() => void handleTestServer(server.config.id)}
                            disabled={testingMcpId === server.config.id}
                          >
                            {testingMcpId === server.config.id ? (
                              <Loader2 className="icon icon--xs spin" />
                            ) : (
                              <RefreshCw className="icon icon--xs" />
                            )}
                            <span>Check command</span>
                          </button>

                          <button
                            type="button"
                            className={`btn btn--xs ${server.enabled ? 'btn--quiet' : 'btn--primary'}`}
                            onClick={() => void handleToggleServer(server.config.id, server.enabled)}
                          >
                            <span>{server.enabled ? 'Disable' : 'Enable'}</span>
                          </button>

                          <button
                            type="button"
                            className="btn btn--danger-quiet btn--xs"
                            onClick={() => void handleRemoveServer(server.config.id)}
                            title="Remove server"
                          >
                            <Trash2 className="icon icon--xs" />
                          </button>
                        </div>
                      </div>

                      {/* Command & description */}
                      <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        <code
                          style={{
                            padding: '2px 6px',
                            background: 'var(--surface-input)',
                            borderRadius: 4,
                            fontFamily: 'var(--font-mono)'
                          }}
                        >
                          {server.config.command} {server.config.args.join(' ')}
                        </code>
                        {server.config.description && <span>— {server.config.description}</span>}
                      </div>

                      {/* Exposed tools list */}
                      {server.tools.length > 0 && (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Exposed Tools:
                          </span>
                          {server.tools.map((t) => (
                            <span
                              key={t.name}
                              style={{
                                fontSize: 11,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: 'rgba(230, 231, 228, 0.08)',
                                color: 'var(--text-primary)',
                                fontFamily: 'var(--font-mono)'
                              }}
                              title={t.description}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}

                      {mcpTestResult[server.config.id] && (
                        <div style={{ fontSize: 12, color: 'var(--status-ok)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 className="icon icon--xs" />
                          <span>{mcpTestResult[server.config.id]}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Group>
        </motion.div>
      )}

      {/* MODAL: ADD CUSTOM MCP SERVER */}
      {showAddModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20
          }}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            style={{
              width: '100%',
              maxWidth: 520,
              background: 'var(--surface-raised)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              boxShadow: 'var(--shadow-xl)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                Connect Custom MCP Server
              </h3>
              <button
                type="button"
                className="btn btn--quiet btn--xs"
                onClick={() => setShowAddModal(false)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Server Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Corporate Jira MCP"
                  value={serverName}
                  onChange={(e) => setServerName(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Executable Command
                </label>
                <input
                  type="text"
                  placeholder="npx, python, node, or binary path"
                  value={serverCommand}
                  onChange={(e) => setServerCommand(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Arguments
                </label>
                <input
                  type="text"
                  placeholder="-y @modelcontextprotocol/server-... (space separated)"
                  value={serverArgs}
                  onChange={(e) => setServerArgs(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', marginBottom: 4, fontWeight: 500, color: 'var(--text-secondary)' }}>
                  Environment Variables (KEY=VALUE per line)
                </label>
                <textarea
                  rows={2}
                  placeholder="SLACK_BOT_TOKEN=xoxb-...\nGITHUB_TOKEN=ghp_..."
                  value={serverEnv}
                  onChange={(e) => setServerEnv(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'var(--surface-input)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontFamily: 'var(--font-mono)'
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <button
                type="button"
                className="btn btn--quiet btn--sm"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={handleAddCustomMcp}
                disabled={!serverName.trim() || !serverCommand.trim()}
              >
                Connect Server
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
