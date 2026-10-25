/**
 * Local high-speed OCR Engine using RapidOCR / PP-OCR ONNX models.
 *
 * Runs 100% locally and offline via ONNX Runtime without external API calls or cloud tokens.
 * Provides character-level accurate text and code extraction from screenshots,
 * enabling text-only models (Antigravity, OpenCode, DeepSeek, Groq, Ollama)
 * to "see" and answer questions about the user's screen.
 */
import { RapidOCR } from 'rapidocr-node'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { logger } from '../logger'

let ocrInstancePromise: Promise<RapidOCR | null> | null = null

/** Locate the bundled RapidOCR models directory. */
export function bundledOcrModelDir(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'models', 'ocr'),
    join(__dirname, '..', '..', 'resources', 'models', 'ocr'),
    join(process.cwd(), 'resources', 'models', 'ocr')
  ]
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'PP-OCRv6_det_small.onnx'))) return candidate
  }
  return null
}

/** Prewarm or retrieve the warm RapidOCR instance. */
export async function getRapidOcr(): Promise<RapidOCR | null> {
  const modelDir = bundledOcrModelDir()
  if (!modelDir) {
    logger.warn('Bundled PP-OCR models directory not found.')
    return null
  }

  if (!ocrInstancePromise) {
    ocrInstancePromise = (async () => {
      try {
        const ocr = await RapidOCR.create({
          detectionModelPath: join(modelDir, 'PP-OCRv6_det_small.onnx'),
          recognitionModelPath: join(modelDir, 'PP-OCRv6_rec_small.onnx'),
          classifierModelPath: join(modelDir, 'ch_ppocr_mobile_v2.0_cls_mobile.onnx'),
          dictionaryPath: join(modelDir, 'multi_PP-OCRv6_rec_small-dictionary.txt'),
          logLevel: 'error',
          useClassifier: false, // Screenshots are already right-side up
          autoDownloadModels: false // Pure offline mode, rely only on bundled models
        })
        return ocr
      } catch (err) {
        logger.error('Failed to initialize RapidOCR engine:', err)
        ocrInstancePromise = null
        return null
      }
    })()
  }
  return ocrInstancePromise
}

/** Prewarm the local OCR engine in memory on launch. */
export function prewarmOcr(): void {
  void getRapidOcr().catch(() => undefined)
}

/**
 * Extract text from a base64 data URL or Buffer using the bundled RapidOCR engine.
 */
export async function ocrExtractText(imageInput: string | Buffer): Promise<string> {
  if (!imageInput || (typeof imageInput === 'string' && !imageInput.trim())) return ''
  const ocr = await getRapidOcr()
  if (!ocr) return ''

  try {
    let payload: Buffer | string = imageInput
    if (typeof imageInput === 'string' && imageInput.startsWith('data:')) {
      const comma = imageInput.indexOf(',')
      if (comma !== -1) {
        payload = Buffer.from(imageInput.slice(comma + 1), 'base64')
      }
    }

    const result = await ocr.recognize(payload as any)
    const lines = result.lines?.map((line) => line.text.trim()).filter(Boolean) ?? []
    return lines.join('\n').trim()
  } catch (error) {
    logger.error('RapidOCR extraction failed:', error)
    return ''
  }
}
