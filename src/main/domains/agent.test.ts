import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Integration tests for the agent task lifecycle. Everything the runner talks to
 * over the wire (automation backend, screen capture, provider, settings, windows)
 * is mocked, so these exercise the real control flow: validation, risk approval,
 * verification, cancellation, bounded recovery and crash recovery.
 */

const h = vi.hoisted(() => ({
  userData: '',
  events: [] as { channel: string; payload: any }[],
  responses: [] as string[],
  performCount: 0,
  confirm: false,
  perform: null as null | ((action: any) => Promise<string>)
}))

vi.mock('electron', () => ({
  app: { getPath: () => h.userData },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: (channel: string, payload: unknown) => h.events.push({ channel, payload }) }
      }
    ]
  }
}))

vi.mock('../providers', () => ({
  getProvider: () => ({
    id: 'fake',
    async *chat() {
      yield h.responses.shift() ?? JSON.stringify({ type: 'done', summary: 'no more steps' })
    },
    test: async () => ({ ok: true, detail: 'fake' })
  })
}))

vi.mock('./automation', () => {
  class InputBackendError extends Error {
    kind: string
    constructor(message: string, kind: string) {
      super(message)
      this.kind = kind
    }
  }
  return {
    InputBackendError,
    automation: {
      capabilities: async () => ({
        platform: 'linux',
        session: 'x11',
        available: true,
        backends: ['xdotool'],
        missing: [],
        installHint: '',
        limitations: [],
        runtime: { kind: 'ready', verifiedBackends: ['xdotool'], checks: [] }
      }),
      perform: async (action: unknown) => {
        h.performCount += 1
        return h.perform ? h.perform(action) : 'did it'
      }
    }
  }
})

vi.mock('./screenshot', () => ({
  captureForAgent: async () => {
    const width = 100
    const height = 100
    const fill = h.performCount % 2 === 0 ? 10 : 220
    return {
      dataUrl: 'data:image/png;base64,',
      bitmap: Buffer.alloc(width * height * 4, fill),
      imageWidth: width,
      imageHeight: height,
      screenWidth: width,
      screenHeight: height,
      name: 'Screen 1'
    }
  }
}))

vi.mock('./settings', () => ({
  settingsDomain: {
    get: () => ({
      activeProvider: 'openai',
      providers: { openai: { baseUrl: 'http://fake', model: 'fake' } },
      agentConfirmConsequential: h.confirm,
      agentMaxSteps: 5,
      systemPrompt: ''
    }),
    apiKey: () => null
  }
}))

const { AgentRunner, categorizeError } = await import('./agent')

const click = JSON.stringify({ type: 'click', x: 10, y: 20, reason: 'press the button' })
const done = (summary: string): string => JSON.stringify({ type: 'done', summary })

beforeEach(() => {
  h.userData = mkdtempSync(join(tmpdir(), 'klyro-agent-'))
  h.events = []
  h.responses = []
  h.performCount = 0
  h.confirm = false
  h.perform = null
})

describe('AgentRunner lifecycle', () => {
  it('verifies a click by observing the screen and completes the task', async () => {
    h.responses = [click, done('Pressed the button')]
    const runner = new AgentRunner()
    await runner.run({ goal: 'press the button' })

    const task = runner.tasks()[0]
    expect(task.state).toBe('completed')
    expect(task.outcome).toBe('done')
    expect(task.finishedAt).toBeGreaterThan(0)
    expect(task.steps[0].status).toBe('verified')
    expect(task.steps[0].verified).toBe(true)
    expect(task.steps[0].screenChanged).toBe(true)
  })

  it('marks an action with no visible effect as unverified rather than executed', async () => {
    // Freeze the screen so verification sees no change.
    h.perform = async () => {
      h.performCount -= 1
      return 'did it'
    }
    h.responses = [click, done('done')]
    const runner = new AgentRunner()
    await runner.run({ goal: 'press the button' })
    expect(runner.tasks()[0].steps[0].status).toBe('unverified')
    expect(runner.tasks()[0].steps[0].verified).toBe(false)
  })

  it('requires and records approval before a consequential action runs', async () => {
    h.confirm = true
    h.responses = [click, done('done')]
    const runner = new AgentRunner()
    const running = runner.run({ goal: 'press the button' })

    // Wait until the runner asks for approval, then approve it.
    await vi.waitFor(() => {
      expect(h.events.some((event) => event.payload.type === 'needsConfirmation')).toBe(true)
    })
    const request = h.events.find((event) => event.payload.type === 'needsConfirmation')
    expect(request?.payload.action.type).toBe('click')
    runner.confirm(request!.payload.runId, true)
    await running

    expect(runner.tasks()[0].outcome).toBe('done')
    expect(runner.tasks()[0].steps[0].status).toBe('verified')
  })

  it('skips a consequential action the user declines', async () => {
    h.confirm = true
    h.responses = [click, done('done')]
    const runner = new AgentRunner()
    const running = runner.run({ goal: 'press the button' })
    await vi.waitFor(() => {
      expect(h.events.some((event) => event.payload.type === 'needsConfirmation')).toBe(true)
    })
    const request = h.events.find((event) => event.payload.type === 'needsConfirmation')
    runner.confirm(request!.payload.runId, false)
    await running
    expect(runner.tasks()[0].steps[0].status).toBe('skipped')
  })

  it('cancels promptly and records a cancelled terminal state', async () => {
    h.perform = () => new Promise<string>((resolve) => setTimeout(() => resolve('did it'), 50))
    h.responses = [click, done('done')]
    const runner = new AgentRunner()
    const running = runner.run({ goal: 'something long' })
    await vi.waitFor(() => expect(runner.status().running).toBe(true))
    runner.cancel()
    await running
    const task = runner.tasks()[0]
    expect(task.state).toBe('cancelled')
    expect(task.outcome).toBe('cancelled')
  })

  it('gives up after bounded retries on malformed planner output', async () => {
    h.responses = ['not json at all', 'still not json', 'nope']
    const runner = new AgentRunner()
    await runner.run({ goal: 'anything' })
    const task = runner.tasks()[0]
    expect(task.state).toBe('failed')
    expect(task.errorCategory).toBe('malformed-action')
  })

  it('pauses and resumes without losing the run', async () => {
    let release: () => void = () => undefined
    h.perform = () =>
      new Promise<string>((resolve) => {
        release = () => resolve('did it')
      })
    h.responses = [click, done('done')]
    const runner = new AgentRunner()
    const running = runner.run({ goal: 'press the button' })
    await vi.waitFor(() => expect(h.events.some((event) => event.payload.type === 'state')).toBe(true))

    runner.pause()
    expect(runner.status().state).toBe('paused')
    runner.resume()
    expect(runner.status().state).toBe('running')

    release()
    await running
    expect(runner.tasks()[0].outcome).toBe('done')
  })

  it('marks a task left running when the app exited as interrupted', () => {
    const stale = [
      {
        id: 'stale-run',
        goal: 'was mid-flight',
        startedAt: Date.now() - 1000,
        finishedAt: 0,
        state: 'running',
        outcome: 'error',
        summary: '',
        steps: []
      }
    ]
    writeFileSync(join(h.userData, 'agent-tasks.json'), JSON.stringify({ tasks: stale }), 'utf8')
    const runner = new AgentRunner()
    const task = runner.tasks()[0]
    expect(task.state).toBe('interrupted')
    expect(task.outcome).toBe('interrupted')
    expect(task.finishedAt).toBeGreaterThan(0)
  })
})

describe('categorizeError', () => {
  it('classifies common failures', () => {
    expect(categorizeError(new Error('There is no data for 90000s'))).toBe('timeout')
    expect(categorizeError(new Error('429 Too Many Requests'))).toBe('rate-limit')
    expect(categorizeError(Object.assign(new Error('boom'), { name: 'MalformedActionError' }))).toBe('malformed-action')
    expect(categorizeError(new Error('socket hang up'))).toBe('model')
  })
})
