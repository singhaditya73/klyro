/**
 * Download the bundled Whisper speech-to-text model if not present.
 *
 * Runs before build / pack so the installer packages the model into the app,
 * giving users 100% offline speech-to-text out of the box without any setup.
 */
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const targetDir = resolve(root, 'resources', 'models', 'whisper')
const targetFile = resolve(targetDir, 'ggml-tiny.en-q5_1.bin')

const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin'

async function download(url, dest) {
  return new Promise((resolvePromise, reject) => {
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return download(res.headers.location, dest).then(resolvePromise).catch(reject)
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download model: HTTP ${res.statusCode}`))
      }
      const total = parseInt(res.headers['content-length'] || '0', 10)
      let downloaded = 0
      const file = createWriteStream(dest)
      res.on('data', (chunk) => {
        downloaded += chunk.length
        if (total > 0 && Math.random() < 0.05) {
          const pct = Math.round((downloaded / total) * 100)
          process.stdout.write(`\rDownloading Whisper model: ${pct}% (${Math.round(downloaded / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB)`)
        }
      })
      res.pipe(file)
      file.on('finish', () => {
        file.close(() => {
          process.stdout.write('\rDownloading Whisper model: 100% done.\n')
          resolvePromise()
        })
      })
      file.on('error', (err) => {
        file.close()
        reject(err)
      })
    }).on('error', reject)
  })
}

async function main() {
  if (existsSync(targetFile)) {
    console.log(`Whisper model already exists: ${targetFile}`)
    return
  }
  mkdirSync(targetDir, { recursive: true })
  console.log(`Downloading bundled Whisper model from ${MODEL_URL}...`)
  try {
    await download(MODEL_URL, targetFile)
    console.log(`Saved bundled model to ${targetFile}`)
  } catch (err) {
    console.error('Failed to download whisper model:', err)
    process.exit(1)
  }
}

main()
