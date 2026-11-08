/**
 * Dual-Channel Meeting Audio Mixer
 *
 * Captures both the user's microphone AND system audio loopback (attendees speaking
 * on Zoom, Google Meet, Microsoft Teams, Slack Huddles, etc.) and mixes them into
 * a single unified MediaStream via the Web Audio API.
 *
 * If system audio loopback is unavailable or denied, it gracefully degrades to pure
 * microphone capture with zero recording interruption.
 */

export interface DualAudioResult {
  stream: MediaStream
  source: 'dual' | 'system' | 'mic'
  label: string
  note?: string
  cleanup: () => void
  getAudioFeatures?: () => {
    micEnergy: number
    sysEnergy: number
    sysFft?: Uint8Array
  }
}

const HARDWARE_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 16000
}

/** Audio is sampled at 10 Hz; two seconds is enough to survive the end-of-speech pause. */
const FEATURE_SAMPLE_MS = 100
const FEATURE_WINDOW_SAMPLES = 20
/** Below this RMS a channel is treated as room noise, not speech. */
const AUDIO_SPEECH_FLOOR = 0.012

function getAudioContextClass(): typeof AudioContext | null {
  if (typeof AudioContext !== 'undefined') return AudioContext
  if (typeof window !== 'undefined' && window.AudioContext) return window.AudioContext
  const legacy =
    typeof window !== 'undefined'
      ? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined
  return legacy ?? null
}

/**
 * Capture system loopback audio track.
 * - Windows: Uses getDisplayMedia with loopback audio.
 * - Linux: Discovers PulseAudio / PipeWire monitor input device.
 */
async function getSystemAudioStream(isWindows: boolean, isLinux: boolean): Promise<{ stream: MediaStream; track: MediaStreamTrack } | null> {
  if (isWindows) {
    try {
      const loopback = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      const audioTracks = loopback.getAudioTracks()
      // Discard video track immediately — only audio is needed
      loopback.getVideoTracks().forEach((track) => track.stop())
      if (audioTracks.length > 0) {
        return { stream: loopback, track: audioTracks[0] }
      }
      loopback.getTracks().forEach((track) => track.stop())
    } catch {
      // Loopback grant rejected or unsupported
    }
  } else if (isLinux) {
    try {
      // Take a quick throwaway mic grant first to ensure device labels are populated
      const throwaway = await navigator.mediaDevices.getUserMedia({ audio: true })
      throwaway.getTracks().forEach((track) => track.stop())

      const devices = await navigator.mediaDevices.enumerateDevices()
      // Linux PulseAudio / PipeWire exposes the output playback bus as "Monitor of <Output>"
      const monitor = devices.find(
        (device) => device.kind === 'audioinput' && /monitor/i.test(device.label)
      )
      if (monitor) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: monitor.deviceId } }
        })
        const audioTracks = stream.getAudioTracks()
        if (audioTracks.length > 0) {
          return { stream, track: audioTracks[0] }
        }
      }
    } catch {
      // Monitor source unavailable
    }
  }
  return null
}

interface FeatureSample {
  micEnergy: number
  sysEnergy: number
  sysFft: Uint8Array<ArrayBuffer> | null
}

function energyOf(analyser: AnalyserNode | null, buffer: Uint8Array<ArrayBuffer> | null): number {
  if (!analyser || !buffer) return 0
  analyser.getByteTimeDomainData(buffer)
  let sum = 0
  for (let index = 0; index < buffer.length; index += 1) {
    const value = (buffer[index] - 128) / 128
    sum += value * value
  }
  return Math.sqrt(sum / buffer.length)
}

/**
 * Samples both channels continuously instead of reading them once after the
 * utterance has ended. Diarization asks "who was speaking just now?", and by
 * the time an utterance ends the live analyser is already quiet — which used to
 * make every line fall back to the last speaker.
 */
function startFeatureWindow(
  context: AudioContext,
  micAnalyser: AnalyserNode | null,
  sysAnalyser: AnalyserNode | null,
  micGain: GainNode | null
): { getAudioFeatures: () => { micEnergy: number; sysEnergy: number; sysFft?: Uint8Array }; dispose: () => void } {
  const micData = micAnalyser ? new Uint8Array(micAnalyser.fftSize) : null
  const sysData = sysAnalyser ? new Uint8Array(sysAnalyser.fftSize) : null
  const sysFreqData = sysAnalyser ? new Uint8Array(sysAnalyser.frequencyBinCount) : null
  const samples: FeatureSample[] = []

  const sample = (): void => {
    try {
      const micEnergy = energyOf(micAnalyser, micData)
      const sysEnergy = energyOf(sysAnalyser, sysData)
      let sysFft: Uint8Array<ArrayBuffer> | null = null
      if (sysAnalyser && sysFreqData && sysEnergy > AUDIO_SPEECH_FLOOR) {
        sysAnalyser.getByteFrequencyData(sysFreqData)
        // Copy, because the analyser overwrites its buffer on the next sample.
        const snapshot = new Uint8Array(sysFreqData.length)
        snapshot.set(sysFreqData)
        sysFft = snapshot
      }

      samples.push({ micEnergy, sysEnergy, sysFft })
      if (samples.length > FEATURE_WINDOW_SAMPLES) samples.shift()

      // Echo suppression: when the far end is louder than the microphone, the
      // microphone is probably hearing the speakers, not the user. Duck it
      // instead of mixing the same voice twice. A loud user still breaks
      // through, so barge-in keeps working.
      if (micGain) {
        const echoLikely = sysEnergy > AUDIO_SPEECH_FLOOR && sysEnergy > micEnergy * 1.15
        const target = echoLikely ? 0.2 : 1
        try {
          micGain.gain.setTargetAtTime(target, context.currentTime, 0.08)
        } catch {
          micGain.gain.value = target
        }
      }
    } catch {
      // Analysis is best-effort; recording must continue without it.
    }
  }

  sample()
  const timer = setInterval(sample, FEATURE_SAMPLE_MS)

  return {
    getAudioFeatures: () => {
      if (samples.length === 0) return { micEnergy: 0, sysEnergy: 0 }
      let micEnergy = 0
      let sysEnergy = 0
      let sysFft: Uint8Array | undefined
      for (const entry of samples) {
        if (entry.micEnergy > micEnergy) micEnergy = entry.micEnergy
        if (entry.sysEnergy > sysEnergy) {
          sysEnergy = entry.sysEnergy
          sysFft = entry.sysFft ?? undefined
        }
      }
      return { micEnergy, sysEnergy, ...(sysFft ? { sysFft: new Uint8Array(sysFft) } : {}) }
    },
    dispose: () => clearInterval(timer)
  }
}

/**
 * Creates a dual-channel mixed audio stream combining microphone and system loopback.
 */
export async function createDualAudioStream(isWindows: boolean, isLinux: boolean): Promise<DualAudioResult> {
  const tracksToCleanup: MediaStreamTrack[] = []
  let audioContext: AudioContext | null = null

  // 1. Acquire microphone stream
  let micStream: MediaStream | null = null
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: HARDWARE_AUDIO_CONSTRAINTS })
    micStream.getAudioTracks().forEach((track) => tracksToCleanup.push(track))
  } catch {
    // If mic failed, try acquiring without constraints
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStream.getAudioTracks().forEach((track) => tracksToCleanup.push(track))
    } catch {
      micStream = null
    }
  }

  // 2. Acquire system loopback stream (attendees)
  let sysResult: { stream: MediaStream; track: MediaStreamTrack } | null = null
  try {
    sysResult = await getSystemAudioStream(isWindows, isLinux)
    if (sysResult) {
      tracksToCleanup.push(sysResult.track)
    }
  } catch {
    sysResult = null
  }

  const AudioContextClass = getAudioContextClass()

  // 3. Mix streams if both are available
  if (micStream && sysResult && AudioContextClass) {
    try {
      audioContext = new AudioContextClass()
      const destination = audioContext.createMediaStreamDestination()

      // Mic audio source
      const micSource = audioContext.createMediaStreamSource(micStream)
      // System loopback audio source
      const sysSource = audioContext.createMediaStreamSource(sysResult.stream)

      // Attach analysers for speaker diarization
      let micAnalyser: AnalyserNode | null = null
      let sysAnalyser: AnalyserNode | null = null
      try {
        micAnalyser = audioContext.createAnalyser()
        micAnalyser.fftSize = 256
        micSource.connect(micAnalyser)

        sysAnalyser = audioContext.createAnalyser()
        sysAnalyser.fftSize = 256
        sysSource.connect(sysAnalyser)
      } catch {
        // Analyser setup optional
      }

      // A compressor keeps two voices from clipping the mixed stream.
      let mixer: AudioNode = destination
      try {
        const compressor = audioContext.createDynamicsCompressor()
        compressor.connect(destination)
        mixer = compressor
      } catch {
        // Compression optional
      }

      let micGain: GainNode | null = null
      try {
        micGain = audioContext.createGain()
        micGain.gain.value = 1
        micSource.connect(micGain)
        micGain.connect(mixer)
      } catch {
        micGain = null
        micSource.connect(mixer)
      }
      sysSource.connect(mixer)

      const features = startFeatureWindow(audioContext, micAnalyser, sysAnalyser, micGain)
      const mixedStream = destination.stream
      // Add mixed audio track to cleanup when stream ends
      mixedStream.getAudioTracks().forEach((track) => tracksToCleanup.push(track))

      return {
        stream: mixedStream,
        source: 'dual',
        label: 'Dual Audio (You + Attendees)',
        getAudioFeatures: features.getAudioFeatures,
        cleanup: () => {
          features.dispose()
          tracksToCleanup.forEach((track) => {
            try { track.stop() } catch {}
          })
          if (audioContext && audioContext.state !== 'closed') {
            void audioContext.close()
          }
        }
      }
    } catch {
      // AudioContext mixing failed, fallback to mic
    }
  }

  // 4. Fallback: If only system loopback is available
  if (sysResult && !micStream) {
    let features: ReturnType<typeof startFeatureWindow> | null = null
    if (AudioContextClass) {
      try {
        const context = new AudioContextClass()
        audioContext = context
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        context.createMediaStreamSource(sysResult.stream).connect(analyser)
        features = startFeatureWindow(context, null, analyser, null)
      } catch {
        features = null
      }
    }
    return {
      stream: new MediaStream([sysResult.track]),
      source: 'system',
      label: 'System Audio (Attendees)',
      ...(features ? { getAudioFeatures: features.getAudioFeatures } : {}),
      cleanup: () => {
        features?.dispose()
        tracksToCleanup.forEach((track) => {
          try { track.stop() } catch {}
        })
        if (audioContext && audioContext.state !== 'closed') {
          void audioContext.close()
        }
      }
    }
  }

  // 5. Fallback: Pure microphone
  if (micStream) {
    return {
      stream: micStream,
      source: 'mic',
      label: 'Microphone',
      getAudioFeatures: () => ({ micEnergy: 0.05, sysEnergy: 0 }),
      note: isWindows
        ? 'System audio was unavailable; recording microphone only.'
        : isLinux
          ? 'No "Monitor of..." system audio found; recording microphone only.'
          : undefined,
      cleanup: () => {
        tracksToCleanup.forEach((track) => {
          try { track.stop() } catch {}
        })
      }
    }
  }

  throw new Error('No audio input or system audio loopback found to record.')
}
