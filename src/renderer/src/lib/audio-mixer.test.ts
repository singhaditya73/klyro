import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createDualAudioStream } from './audio-mixer'

describe('createDualAudioStream', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to microphone when loopback is unsupported or unavailable', async () => {
    const mockTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const mockStream = {
      getAudioTracks: () => [mockTrack],
      getTracks: () => [mockTrack]
    } as unknown as MediaStream

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(mockStream),
        getDisplayMedia: vi.fn().mockRejectedValue(new Error('denied')),
        enumerateDevices: vi.fn().mockResolvedValue([])
      }
    })

    const result = await createDualAudioStream(false, false)
    expect(result.source).toBe('mic')
    expect(result.label).toBe('Microphone')
    expect(result.stream).toBe(mockStream)

    result.cleanup()
    expect(mockTrack.stop).toHaveBeenCalled()
  })

  it('mixes mic and system audio loopback when both are available', async () => {
    const micTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const micStream = {
      getAudioTracks: () => [micTrack],
      getTracks: () => [micTrack]
    } as unknown as MediaStream

    const sysAudioTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const sysVideoTrack = { stop: vi.fn(), kind: 'video' } as unknown as MediaStreamTrack
    const sysStream = {
      getAudioTracks: () => [sysAudioTrack],
      getVideoTracks: () => [sysVideoTrack],
      getTracks: () => [sysAudioTrack, sysVideoTrack]
    } as unknown as MediaStream

    const mixedTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const mixedStream = {
      getAudioTracks: () => [mixedTrack],
      getTracks: () => [mixedTrack]
    } as unknown as MediaStream

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(micStream),
        getDisplayMedia: vi.fn().mockResolvedValue(sysStream),
        enumerateDevices: vi.fn().mockResolvedValue([])
      }
    })

    const mockConnect = vi.fn()
    const mockDestination = { stream: mixedStream }
    const closeFn = vi.fn()
    class MockAudioContext {
      createMediaStreamDestination = vi.fn().mockReturnValue(mockDestination)
      createMediaStreamSource = vi.fn().mockReturnValue({ connect: mockConnect })
      close = closeFn
      state = 'running'
    }

    vi.stubGlobal('AudioContext', MockAudioContext)
    if (typeof window !== 'undefined') {
      window.AudioContext = MockAudioContext as unknown as typeof AudioContext
    }

    const result = await createDualAudioStream(true, false) // Windows test
    expect(result.source).toBe('dual')
    expect(result.label).toContain('Dual Audio')
    expect(result.stream).toBe(mixedStream)
    expect(mockConnect).toHaveBeenCalledTimes(2) // Both mic and system audio connected to destination

    result.cleanup()
    expect(micTrack.stop).toHaveBeenCalled()
    expect(sysAudioTrack.stop).toHaveBeenCalled()
    expect(closeFn).toHaveBeenCalled()
  })

  it('samples both channels continuously and ducks the mic when attendees dominate', async () => {
    const micTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const micStream = {
      getAudioTracks: () => [micTrack],
      getTracks: () => [micTrack]
    } as unknown as MediaStream

    const sysAudioTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const sysStream = {
      getAudioTracks: () => [sysAudioTrack],
      getVideoTracks: () => [],
      getTracks: () => [sysAudioTrack]
    } as unknown as MediaStream

    const mixedTrack = { stop: vi.fn(), kind: 'audio' } as unknown as MediaStreamTrack
    const mixedStream = {
      getAudioTracks: () => [mixedTrack],
      getTracks: () => [mixedTrack]
    } as unknown as MediaStream

    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue(micStream),
        getDisplayMedia: vi.fn().mockResolvedValue(sysStream),
        enumerateDevices: vi.fn().mockResolvedValue([])
      }
    })

    let analyserIndex = 0
    const createAnalyser = vi.fn(() => {
      // The microphone is silent; the system loopback carries a loud attendee.
      const silent = analyserIndex === 0
      analyserIndex += 1
      const analyser = {
        fftSize: 256,
        frequencyBinCount: 128,
        getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(silent ? 128 : 200),
        getByteFrequencyData: (buffer: Uint8Array) => buffer.fill(90)
      }
      return analyser
    })

    const setTargetAtTime = vi.fn()
    const gain = { value: 1, setTargetAtTime }

    class MockAudioContext {
      currentTime = 0
      createMediaStreamDestination = vi.fn().mockReturnValue({ stream: mixedStream })
      createMediaStreamSource = vi.fn().mockReturnValue({ connect: vi.fn() })
      createAnalyser = createAnalyser
      createDynamicsCompressor = vi.fn().mockReturnValue({ connect: vi.fn() })
      createGain = vi.fn().mockReturnValue({ gain, connect: vi.fn() })
      close = vi.fn()
      state = 'running'
    }

    vi.stubGlobal('AudioContext', MockAudioContext)

    const result = await createDualAudioStream(true, false)
    expect(result.source).toBe('dual')

    const features = result.getAudioFeatures?.()
    expect(features?.micEnergy).toBe(0)
    expect(features?.sysEnergy).toBeGreaterThan(0.5)
    expect(features?.sysFft?.length).toBe(128)

    // Attendee louder than the mic => the mic track is ducked instead of
    // echoing the speakers back into the meeting.
    const lastCall = setTargetAtTime.mock.calls[setTargetAtTime.mock.calls.length - 1]
    expect(lastCall?.[0]).toBeCloseTo(0.2)

    result.cleanup()
    expect(micTrack.stop).toHaveBeenCalled()
    expect(sysAudioTrack.stop).toHaveBeenCalled()
  })
})
