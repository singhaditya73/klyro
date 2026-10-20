import { describe, expect, it } from 'vitest'
import { buildInitialMetadata } from './antigravity-service'

/** Read one length-delimited field out of a protobuf message. */
function readStringFields(buffer: Buffer): Record<number, string> {
  const fields: Record<number, string> = {}
  let offset = 0
  while (offset < buffer.length) {
    // varint tag
    let tag = 0
    let shift = 0
    while (offset < buffer.length) {
      const byte = buffer[offset]
      offset += 1
      tag |= (byte & 0x7f) << shift
      if ((byte & 0x80) === 0) break
      shift += 7
    }
    const number = tag >> 3
    const wire = tag & 7
    if (wire === 2) {
      let length = 0
      shift = 0
      while (offset < buffer.length) {
        const byte = buffer[offset]
        offset += 1
        length |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) break
        shift += 7
      }
      fields[number] = buffer.subarray(offset, offset + length).toString('utf8')
      offset += length
    } else if (wire === 0) {
      // varint
      while (offset < buffer.length) {
        const byte = buffer[offset]
        offset += 1
        if ((byte & 0x80) === 0) break
      }
    } else {
      break
    }
  }
  return fields
}

describe('Antigravity initial metadata', () => {
  it('encodes the fields the language server expects', () => {
    const metadata = buildInitialMetadata({
      extensionPath: '/opt/antigravity-ide/resources/app/extensions/antigravity',
      apiKey: 'token-value',
      deviceFingerprint: 'klyro'
    })
    const fields = readStringFields(metadata)

    expect(fields[1]).toBe('/opt/antigravity-ide/resources/app/extensions/antigravity') // extension_path
    expect(fields[4]).toBe('en') // locale
    expect(fields[8]).toBe('antigravity') // ide_name
    expect(fields[12]).toBe('antigravity') // extension_name
    expect(fields[24]).toBe('klyro') // device_fingerprint
    expect(fields[26]).toBe('token-value') // api_key
    expect(fields[29]).toBe('') // user_tier_id
  })

  it('carries a timestamp and the telemetry flag', () => {
    const metadata = buildInitialMetadata({ extensionPath: '/x' })
    // The timestamp is a nested message (field 16) and the flag a varint (27).
    expect(metadata.includes(Buffer.from([(16 << 3) | 2]))).toBe(true)
    expect(metadata.includes(Buffer.from([(27 << 3) | 0]))).toBe(true)
  })
})
