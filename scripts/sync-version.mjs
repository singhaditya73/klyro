/**
 * Keep the daemon's reported version equal to the app's.
 *
 * The app replaces a daemon whose `hello.version` differs from its own, which
 * is how a Rust fix reaches an app update instead of waiting for the old daemon
 * process to die. That check only works if `klyro-core` is built with the same
 * version as the app, so `npm version` runs this first.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const manifestPath = resolve(root, 'crates/klyro-core/Cargo.toml')
const manifest = readFileSync(manifestPath, 'utf8')
const updated = manifest.replace(/^version = "[^"]*"$/m, `version = "${version}"`)

if (updated === manifest) {
  console.log(`klyro-core is already ${version}`)
} else {
  writeFileSync(manifestPath, updated)
  console.log(`klyro-core ${version}`)
}
