import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Play, Square, Volume2 } from 'lucide-react'

interface AudioDevice {
  deviceId: string
  label: string
}

export function AudioDeviceMeter(): React.JSX.Element {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [testingMic, setTestingMic] = useState(false)
  const [testingSpeaker, setTestingSpeaker] = useState(false)
  const [micDb, setMicDb] = useState(-60)
  const [peakDb, setPeakDb] = useState(-60)
  const [micStatus, setMicStatus] = useState<string>('Idle')

  const micContextRef = useRef<AudioContext | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // Enumerate input devices
  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return
      const list = await navigator.mediaDevices.enumerateDevices()
      const inputs = list
        .filter((d) => d.kind === 'audioinput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${index + 1}`
        }))
      setDevices(inputs)
      if (inputs.length > 0 && !selectedDevice) {
        setSelectedDevice(inputs[0].deviceId)
      }
    } catch {
      // Ignored if permissions not yet requested
    }
  }, [selectedDevice])

  useEffect(() => {
    void loadDevices()
    return () => {
      stopMicTest()
    }
  }, [loadDevices])

  const stopMicTest = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop())
      micStreamRef.current = null
    }
    if (micContextRef.current && micContextRef.current.state !== 'closed') {
      void micContextRef.current.close().catch(() => {})
      micContextRef.current = null
    }
    setTestingMic(false)
    setMicDb(-60)
    setPeakDb(-60)
    setMicStatus('Idle')
  }, [])

  const startMicTest = useCallback(async () => {
    stopMicTest()
    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice
          ? { deviceId: { exact: selectedDevice } }
          : true
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      micStreamRef.current = stream

      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtor()
      micContextRef.current = ctx

      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.3
      source.connect(analyser)

      const buffer = new Float32Array(analyser.fftSize)
      let currentPeak = -60
      let lastPeakDecay = Date.now()

      setTestingMic(true)
      setMicStatus('Listening...')

      const updateMeter = () => {
        analyser.getFloatTimeDomainData(buffer)
        let sumSquares = 0
        for (let i = 0; i < buffer.length; i++) {
          sumSquares += buffer[i] * buffer[i]
        }
        const rms = Math.sqrt(sumSquares / buffer.length)
        // Convert to dB (-60 dB noise floor to 0 dB max)
        const db = rms > 0.0001 ? 20 * Math.log10(rms) : -60
        const clampedDb = Math.max(-60, Math.min(0, Math.round(db)))

        if (clampedDb > currentPeak) {
          currentPeak = clampedDb
          lastPeakDecay = Date.now()
        } else if (Date.now() - lastPeakDecay > 1000) {
          currentPeak = Math.max(-60, currentPeak - 1.5)
        }

        setMicDb(clampedDb)
        setPeakDb(currentPeak)

        if (clampedDb > -3) {
          setMicStatus('Clipping / Very Loud')
        } else if (clampedDb > -22) {
          setMicStatus('Good speech level')
        } else if (clampedDb > -45) {
          setMicStatus('Soft / Room voice')
        } else {
          setMicStatus('Silence / Low background')
        }

        animFrameRef.current = requestAnimationFrame(updateMeter)
      }

      updateMeter()
      // Also refresh device list now that permissions were granted
      void loadDevices()
    } catch (err) {
      setMicStatus(`Mic test failed: ${(err as Error).message}`)
      setTestingMic(false)
    }
  }, [loadDevices, selectedDevice, stopMicTest])

  // Play a pleasant two-tone chime via Web Audio oscillator
  const playSpeakerTest = useCallback(() => {
    try {
      setTestingSpeaker(true)
      const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtor()

      const now = ctx.currentTime
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()

      osc.type = 'sine'
      // Pleasant dual tone: 523.25 Hz (C5) -> 659.25 Hz (E5)
      osc.frequency.setValueAtTime(523.25, now)
      osc.frequency.setValueAtTime(659.25, now + 0.18)

      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.2, now + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5)

      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.start(now)
      osc.stop(now + 0.55)

      window.setTimeout(() => {
        void ctx.close().catch(() => {})
        setTestingSpeaker(false)
      }, 600)
    } catch {
      setTestingSpeaker(false)
    }
  }, [])

  // Calculate meter percentage (0% at -60dB, 100% at 0dB)
  const meterPercent = Math.min(100, Math.max(0, ((micDb + 60) / 60) * 100))
  const peakPercent = Math.min(100, Math.max(0, ((peakDb + 60) / 60) * 100))

  return (
    <div
      className="audio-device-meter"
      style={{
        marginTop: 12,
        padding: 16,
        borderRadius: 'var(--radius-md)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mic className="icon icon--sm" style={{ color: 'var(--accent)' }} aria-hidden="true" />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            Live Audio Diagnostic &amp; dB Meters
          </span>
        </div>

        <button
          type="button"
          className="btn btn--quiet btn--xs"
          onClick={playSpeakerTest}
          disabled={testingSpeaker}
          title="Play a test tone through speakers/headphones"
        >
          <Volume2 className="icon icon--xs" aria-hidden="true" />
          <span>{testingSpeaker ? 'Playing tone…' : 'Test Speaker'}</span>
        </button>
      </div>

      {/* Mic selector & Test trigger */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select
          value={selectedDevice}
          onChange={(e) => setSelectedDevice(e.target.value)}
          disabled={testingMic}
          style={{
            flex: 1,
            minWidth: 200,
            fontSize: 12,
            padding: '6px 10px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--surface-input)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-primary)'
          }}
        >
          {devices.length === 0 ? (
            <option value="">Default System Microphone</option>
          ) : (
            devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))
          )}
        </select>

        {testingMic ? (
          <button type="button" className="btn btn--danger btn--sm" onClick={stopMicTest}>
            <Square className="icon icon--xs" aria-hidden="true" />
            <span>Stop Test</span>
          </button>
        ) : (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void startMicTest()}>
            <Play className="icon icon--xs" aria-hidden="true" />
            <span>Test Mic</span>
          </button>
        )}
      </div>

      {/* Live dB Meter Track */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)' }}>
          <span>Level: <strong style={{ color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>{testingMic ? `${micDb} dB` : '—'}</strong></span>
          <span>{micStatus}</span>
        </div>

        <div
          style={{
            position: 'relative',
            height: 12,
            borderRadius: 6,
            background: 'var(--surface-sunken)',
            border: '1px solid var(--border-subtle)',
            overflow: 'hidden'
          }}
          aria-hidden="true"
        >
          {/* Active Level Bar with gradient from Green to Amber to Orange */}
          <div
            style={{
              height: '100%',
              width: `${meterPercent}%`,
              background: 'linear-gradient(90deg, #10b981 0%, #10b981 65%, #f59e0b 85%, #f97316 100%)',
              transition: 'width 60ms linear'
            }}
          />
          {/* Peak Hold Marker */}
          {testingMic && peakPercent > 0 && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `calc(${peakPercent}% - 2px)`,
                width: 2,
                background: '#ffffff',
                boxShadow: '0 0 4px #ffffff',
                transition: 'left 120ms ease-out'
              }}
            />
          )}
        </div>

        {/* dB Scale Marks */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 9,
            color: 'var(--text-disabled)',
            fontFamily: 'var(--font-mono)'
          }}
        >
          <span>-60 dB</span>
          <span>-40 dB</span>
          <span>-20 dB</span>
          <span>-12 dB</span>
          <span>-6 dB</span>
          <span style={{ color: 'var(--warning)' }}>0 dB</span>
        </div>
      </div>
    </div>
  )
}
