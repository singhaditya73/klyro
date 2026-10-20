import { useCallback, useEffect, useState } from 'react'
import { Blocks, Loader2, Plug, RefreshCcw, Trash2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Play, Eye, FileText, MessageSquare, Plus } from 'lucide-react'

/**
 * Bring-your-own tools via local MCP (Model Context Protocol) servers. A server
 * is a plain stdio command Klyro spawns — the same "mcpServers" entry an editor
 * like VS Code or Claude Desktop would take. Tools are listed over the protocol
 * and can be invoked directly from here; every call is written to the audit log.
 */

interface MCPServerState {
  config: { id: string; name: string; command: string; args: string[] }
  running: boolean
  tools: { name: string; description?: string }[]
  resources?: { uri?: string; name?: string; description?: string; mimeType?: string }[]
  prompts?: { name?: string; description?: string }[]
  lastError: string | null
}

export function McpSection() {
  const [servers, setServers] = useState<MCPServerState[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [openTools, setOpenTools] = useState<Record<string, boolean>>({})
  const [callPrompt, setCallPrompt] = useState<{ serverId: string; tool: string } | null>(null)
  const [callArgs, setCallArgs] = useState('{}')
  const [callResult, setCallResult] = useState<string | null>(null)
  const [resourcePreview, setResourcePreview] = useState<{ uri: string; text: string } | null>(null)
  const [importable, setImportable] = useState<Array<{ source: string; name: string; command: string; args: string[]; env?: Record<string, string>; alreadyAdded: boolean }> | null>(null)

  // MCP servers the user already configured in OpenCode, Claude Code and
  // friends: one click to take them over, with their command and environment.
  const scanImportable = useCallback(async (): Promise<void> => {
    try {
      const found = await window.klyro.mcpImportDiscover()
      setImportable(found.filter((server) => !server.alreadyAdded))
    } catch {
      setImportable([])
    }
  }, [])

  useEffect(() => {
    void scanImportable()
  }, [scanImportable])

  const readResource = useCallback(async (serverId: string, uri: string): Promise<void> => {
    if (!uri) return
    setBusy(true)
    setError(null)
    try {
      const result = await window.klyro.mcpReadResource({ serverId, uri })
      setResourcePreview({ uri, text: result.text })
    } catch (readError) {
      setError((readError as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setServers(await window.klyro.mcpServers())
    } catch (loadError) {
      setError((loadError as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function addServer(): Promise<void> {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const label = name.trim()
      const parsedArgs = args.trim() ? args.trim().split(/\s+/) : []
      await window.klyro.mcpAddServer({ name: name.trim(), command: command.trim(), args: parsedArgs })
      setName("")
      setCommand("")
      setArgs("")
      setNotice(`Server "${label}" added.`)
      await load()
    } catch (addError) {
      setError((addError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function removeServer(id: string, label: string): Promise<void> {
    setBusy(true)
    try {
      await window.klyro.mcpRemoveServer(id)
      setNotice(`Removed ${label}.`)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function refreshServer(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.klyro.mcpRefreshTools(id)
      await load()
    } catch (refreshError) {
      setError((refreshError as Error).message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function runTool(): Promise<void> {
    if (!callPrompt) return
    setBusy(true)
    setError(null)
    setCallResult(null)
    try {
      const parsed = JSON.parse(callArgs) as Record<string, unknown>
      const result = await window.klyro.mcpCallTool({ serverId: callPrompt.serverId, name: callPrompt.tool, args: parsed })
      setCallResult(result.text)
    } catch (callError) {
      setError((callError as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
        <div className="icon-tile">
          <Blocks aria-hidden="true" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>MCP servers</h2>
            <span className="pill">{servers.length} configured</span>
          </div>
          <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            Connect local Model Context Protocol servers — the same stdio commands editors use. Klyro lists their tools and calls them; every call is audited.
          </p>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => void load()} disabled={loading || busy}>
          <RefreshCcw className="icon icon--xs" style={loading ? { animation: 'spin 1s linear infinite' } : undefined} aria-hidden="true" />
          <span>Refresh</span>
        </button>
      </div>

      {error && (
        <div className="notice notice--error" style={{ marginBottom: 16 }}>
          <span className="icon icon--sm notice__icon" aria-hidden="true"><AlertCircle /></span>
          <span className="notice__body">{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice notice--success" style={{ marginBottom: 16 }}>
          <span className="icon icon--sm notice__icon" aria-hidden="true"><CheckCircle /></span>
          <span className="notice__body">{notice}</span>
        </div>
      )}

      {importable && importable.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--border-default)' }}>
          <div className="card__row" style={{ flexWrap: 'wrap' }}>
            <Blocks className="icon icon--sm" style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
            <div style={{ flex: 1, minWidth: 200 }}>
              <div className="card__title">MCP servers you already run</div>
              <div className="card__subtitle">
                Found in your {importable[0].source === 'opencode' ? 'OpenCode' : 'Claude'} config — import them
                with their command and environment intact.
              </div>
            </div>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {importable.map((server) => (
              <div key={`${server.source}-${server.name}`} className="card__row" style={{ gap: 8, fontSize: 12 }}>
                <code>{server.name}</code>
                <span className="muted" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {server.command} {server.args.join(' ')}
                </span>
                <button
                  className="btn btn--primary btn--sm"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void window.klyro
                      .mcpImportAdd({ name: server.name, command: server.command, args: server.args, env: server.env })
                      .then(() => {
                        setImportable((previous) => (previous ?? []).filter((item) => item.name !== server.name))
                        void load()
                      })
                      .catch((error) => setError((error as Error).message))
                      .finally(() => setBusy(false))
                  }}
                >
                  <Plus className="icon icon--xs" aria-hidden="true" />
                  <span>Import</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {servers.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {servers.map((server) => (
            <div key={server.config.id} className="card">
              <div className="card__row" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Plug className="icon" style={{ color: server.running ? 'var(--success)' : 'var(--text-muted)', animation: server.running ? 'spin 1.6s linear infinite' : undefined }} aria-hidden="true" />
                <strong style={{ flex: 1, minWidth: 0 }}>{server.config.name}</strong>
                <span className={`pill ${server.running ? 'pill--ok' : 'pill--warn'}`}>{server.running ? 'Running' : 'Idle'}</span>
                <span className="pill">{server.tools.length} tools</span>
                {(server.resources?.length ?? 0) > 0 && <span className="pill">{server.resources?.length} resources</span>}
                {(server.prompts?.length ?? 0) > 0 && <span className="pill">{server.prompts?.length} prompts</span>}
                <button className="btn btn--icon btn--icon-sm btn--ghost" onClick={() => setOpenTools((previous) => ({ ...previous, [server.config.id]: !previous[server.config.id] }))} aria-expanded={Boolean(openTools[server.config.id])} aria-label={`Toggle tools for ${server.config.name}`}>
                  {openTools[server.config.id] ? <ChevronUp className="icon icon--sm" aria-hidden="true" /> : <ChevronDown className="icon icon--sm" aria-hidden="true" />}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => void refreshServer(server.config.id)} disabled={busy} aria-label={`Refresh tools for ${server.config.name}`}>
                  <RefreshCcw className="icon icon--xs" aria-hidden="true" />
                  <span>Refresh</span>
                </button>
                <button className="btn btn--icon btn--icon-sm btn--ghost conv__delete" onClick={() => void removeServer(server.config.id, server.config.name)} disabled={busy} aria-label={'Remove ' + server.config.name}>
                  <Trash2 className="icon icon--xs" aria-hidden="true" />
                </button>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                {server.config.command} {server.config.args.join(' ')}
              </div>
              {server.lastError && (
                <div className="notice notice--error" style={{ marginTop: 10 }}>
                  <span className="icon icon--sm notice__icon" aria-hidden="true"><AlertCircle /></span>
                  <span className="notice__body">{server.lastError}</span>
                </div>
              )}
              {openTools[server.config.id] && (
                <div style={{ marginTop: 12 }}>
                  {(server.resources?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="section-label" style={{ marginBottom: 6 }}>Resources</div>
                      {server.resources?.map((resource) => (
                        <div key={resource.uri ?? resource.name} className="card__row" style={{ alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                          <FileText className="icon icon--xs" aria-hidden="true" />
                          <span style={{ fontWeight: 500 }}>{resource.name ?? resource.uri}</span>
                          <span className="muted" style={{ flex: 1, minWidth: 0 }}>{resource.description ?? resource.uri ?? ''}</span>
                          <button
                            className="btn btn--ghost btn--sm"
                            disabled={busy || !resource.uri}
                            onClick={() => { void readResource(server.config.id, resource.uri ?? '') }}
                            aria-label={'Read ' + (resource.name ?? resource.uri)}
                          >
                            <Eye className="icon icon--xs" aria-hidden="true" />
                            <span>Read</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(server.prompts?.length ?? 0) > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div className="section-label" style={{ marginBottom: 6 }}>Prompts</div>
                      {server.prompts?.map((prompt) => (
                        <div key={prompt.name} className="card__row" style={{ alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                          <MessageSquare className="icon icon--xs" aria-hidden="true" />
                          <span style={{ fontWeight: 500 }}>{prompt.name}</span>
                          <span className="muted" style={{ flex: 1, minWidth: 0 }}>{prompt.description ?? ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {server.tools.length === 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>No tools listed — refresh, or check the command runs outside Klyro.</div>
                  ) : (
                    server.tools.map((tool) => (
                      <div key={tool.name} className="card__row" style={{ alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0' }}>
                        <code>{tool.name}</code>
                        <span className="muted" style={{ flex: 1, minWidth: 0 }}>{tool.description ?? ''}</span>
                        <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => { setCallPrompt({ serverId: server.config.id, tool: tool.name }); setCallArgs('{}'); setCallResult(null); }} aria-label={'Invoke ' + tool.name}>
                          <Play className="icon icon--xs" aria-hidden="true" />
                          <span>Run</span>
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <div className="muted" style={{ fontSize: 13 }}>
            {loading ? 'Listing servers…' : 'No MCP servers yet — add one below to bring your own tools into Klyro.'}
          </div>
        </div>
      )}

      {resourcePreview && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card__row">
            <FileText className="icon icon--sm" aria-hidden="true" />
            <strong style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {resourcePreview.uri}
            </strong>
            <button className="btn btn--ghost btn--sm" onClick={() => setResourcePreview(null)}>
              <span>Close</span>
            </button>
          </div>
          <pre className="transcript" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{resourcePreview.text}</pre>
        </div>
      )}

      {callPrompt && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="field">
            <span className="field__label">Invoke <code>{callPrompt.tool}</code> — arguments (JSON object)</span>
            <textarea rows={3} className="field" value={callArgs} onChange={(event) => setCallArgs(event.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
            <div className="provider__actions" style={{ marginTop: 10, gap: 10, alignItems: 'center' }}>
              <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => void runTool()}>
                {busy ? <Loader2 className="icon icon--xs" style={{ animation: 'spin 1s linear infinite' }} aria-hidden="true" /> : <Play className="icon icon--xs" aria-hidden="true" />}
                <span>Call tool</span>
              </button>
              <button className="btn btn--ghost btn--sm" onClick={() => setCallPrompt(null)}>Cancel</button>
            </div>
            {callResult && <pre className="transcript" style={{ marginTop: 10, whiteSpace: 'pre-wrap' }}>{callResult}</pre>}
          </div>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div className="card">
          <div className="field">
            <span className="field__label">Add a server</span>
            <span className="muted" style={{ fontSize: 12 }}>
              A local executable that speaks MCP over stdio — e.g. <code>npx @modelcontextprotocol/server-github</code>. The command is spawned directly (no shell) and only talks to Klyro on this machine.
            </span>
            <div className="key-row" style={{ marginTop: 12 }}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Display name (e.g. GitHub)"
                className="field"
                style={{ maxWidth: 200 }}
              />
              <input
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder="Command (e.g. npx)"
                className="field"
                aria-label="MCP server command"
              />
            </div>
            <input
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              placeholder="Arguments, space-separated (e.g. -y @modelcontextprotocol/server-github)"
              className="field"
              style={{ marginTop: 8 }}
              aria-label="MCP server arguments"
            />
            <div className="provider__actions" style={{ marginTop: 12 }}>
              <button className="btn btn--primary" disabled={!name.trim() || !command.trim() || busy} onClick={() => void addServer()}>
                <Plug className="icon icon--sm" aria-hidden="true" />
                <span>Add server</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
