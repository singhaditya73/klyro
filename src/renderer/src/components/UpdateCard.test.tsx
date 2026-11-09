// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UpdateCard } from './UpdateCard'

/**
 * The update card is the only place the three steps are visible. It must never
 * offer a download before a check found one, and it must say why an install
 * cannot update itself instead of showing a reassuring "up to date".
 */

afterEach(cleanup)

function bridge(overrides: Record<string, unknown> = {}): void {
  window.klyro = {
    updateStatus: vi.fn(async () => ({ phase: 'idle', currentVersion: '0.9.24' })),
    updateCheck: vi.fn(async () => ({ phase: 'available', currentVersion: '0.9.24', version: '0.9.25' })),
    updateDownload: vi.fn(async () => ({ phase: 'ready', currentVersion: '0.9.24', version: '0.9.25' })),
    updateInstall: vi.fn(async () => undefined),
    onUpdateStatus: vi.fn(() => () => undefined),
    ...overrides
  } as unknown as typeof window.klyro
}

describe('the update card', () => {
  it('offers a check first, not a download', async () => {
    bridge()
    render(<UpdateCard />)
    expect(await screen.findByText('Check now')).toBeTruthy()
    expect(screen.queryByText('Download')).toBeNull()
  })

  it('offers the download once a version is found', async () => {
    bridge()
    render(<UpdateCard />)
    fireEvent.click(await screen.findByText('Check now'))

    expect(await screen.findByText('Version 0.9.25 is available')).toBeTruthy()
    expect(screen.getByText('Download')).toBeTruthy()
    expect(window.klyro.updateDownload).not.toHaveBeenCalled()
  })

  it('asks for a restart only after the download is finished', async () => {
    bridge()
    render(<UpdateCard />)
    fireEvent.click(await screen.findByText('Check now'))
    fireEvent.click(await screen.findByText('Download'))

    expect(await screen.findByText('Version 0.9.25 is ready')).toBeTruthy()
    fireEvent.click(screen.getByText('Restart now'))
    await waitFor(() => expect(window.klyro.updateInstall).toHaveBeenCalledTimes(1))
  })

  it('explains an install that updates by hand', async () => {
    bridge({
      updateStatus: vi.fn(async () => ({
        phase: 'unsupported',
        currentVersion: '0.9.24',
        message: 'This install cannot update itself. Download the new version from the releases page.'
      }))
    })
    render(<UpdateCard />)
    expect(await screen.findByText('This install updates by hand')).toBeTruthy()
    expect(screen.getByText(/releases page/)).toBeTruthy()
  })
})
