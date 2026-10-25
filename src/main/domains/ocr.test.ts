import { describe, expect, it } from 'vitest'
import { bundledOcrModelDir, ocrExtractText } from './ocr'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

describe('bundled OCR engine', () => {
  it('locates the bundled RapidOCR PP-OCR model files when present', () => {
    const dir = bundledOcrModelDir()
    if (dir) {
      expect(existsSync(join(dir, 'PP-OCRv6_det_small.onnx'))).toBe(true)
    } else {
      expect(dir).toBeNull()
    }
  })

  it('gracefully handles empty or invalid inputs', async () => {
    const emptyResult = await ocrExtractText('')
    expect(emptyResult).toBe('')
  })

  it('accurately extracts text from screen images with RapidOCR', async () => {
    const testImage = '/home/aditya/.gemini/antigravity-ide/brain/96537371-8bdc-48bd-9f57-a2d3f1b08049/.user_uploaded/media_1792772830326.png'
    if (existsSync(testImage)) {
      const text = await ocrExtractText(testImage)
      expect(text).toContain('Klyro')
      expect(text).toContain('Antigravity')
    }
  }, 10000)
})
