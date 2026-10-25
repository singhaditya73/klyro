/**
 * Download the bundled PP-OCR ONNX models if not present.
 *
 * Runs before build / pack so the installer packages the PP-OCR models into the app,
 * giving users 100% offline, zero-latency local OCR out of the box without any setup.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadModels } from 'rapidocr-node'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const targetDir = resolve(root, 'resources', 'models', 'ocr')
const targetModel = resolve(targetDir, 'PP-OCRv6_det_small.onnx')

async function main() {
  if (existsSync(targetModel)) {
    console.log(`PP-OCR models already exist in: ${targetDir}`)
    return
  }
  mkdirSync(targetDir, { recursive: true })
  console.log(`Downloading bundled PP-OCR ONNX models to ${targetDir}...`)
  try {
    const paths = await downloadModels({ modelsDir: targetDir })
    console.log('Saved bundled PP-OCR models successfully:', paths)
  } catch (err) {
    console.error('Failed to download PP-OCR models:', err)
    process.exit(1)
  }
}

main()
