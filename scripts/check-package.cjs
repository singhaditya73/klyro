#!/usr/bin/env node
/**
 * Packaging check: the app that ships can actually load its own code.
 *
 * This exists because 0.9.23 shipped a Windows installer that crashed on
 * launch with `Cannot find module '../doc/directives.js'`. The cause was a
 * `files` exclusion in electron-builder.yml that removed every directory
 * named `doc` inside node_modules — but the `yaml` package keeps runtime code
 * in `dist/doc/`. Nothing in the test suite noticed, because the tests run
 * against the repository's node_modules, not against the packaged asar.
 *
 * So this walks the built `app.asar` and asks:
 *   1. Does every declared entry point (`main`, `bin`, `exports` require/node/
 *      default) exist in the archive, when it exists in the source tree?
 *   2. Does every relative `require('./…')` / `import './…'` in the shipped
 *      JavaScript resolve to a file in the archive (or in app.asar.unpacked,
 *      where native modules live)?
 *   3. Does the module graph reachable from the app's entry points resolve
 *      every bare dependency to a package in the archive?
 *   4. Is every native library (.node/.so/.dylib/.dll) unpacked? dlopen()
 *      cannot read from inside an archive, and a library that stays inside is
 *      a silent runtime failure, not a build error.
 *
 * Only files that exist in the source tree but not in the archive are
 * reported: a package whose own entry point is missing upstream is a package
 * bug, not a packaging bug, and would be noise here.
 *
 * Usage (after `npm run build && npx electron-builder --linux --dir`):
 *   node scripts/check-package.cjs
 *   node scripts/check-package.cjs release/win-unpacked/resources/app.asar
 *
 * Exits non-zero and prints the missing files, so CI fails before upload.
 */
const { existsSync } = require('node:fs')
const path = require('node:path')
const { join, resolve } = path
// Archive paths are always forward-slash, whatever platform the check runs on,
// so they are handled with the posix implementation rather than the host one.
const { dirname, normalize } = path.posix
const asar = require('@electron/asar')

/**
 * @electron/asar splits an archive path on the *host* separator, so a
 * forward-slash path fails to resolve on Windows. Archive paths stay
 * forward-slash everywhere in this file; they are converted only at the API
 * boundary.
 */
const hostPath = (archivePath) => (path.sep === '/' ? archivePath : archivePath.split('/').join(path.sep))

const root = resolve(__dirname, '..')
const archive = resolve(process.argv[2] || 'release/linux-unpacked/resources/app.asar')
if (!existsSync(archive)) {
  console.error(`package check: no archive at ${archive}`)
  console.error('build one first: npm run build && npx electron-builder --linux --dir')
  process.exit(2)
}

/** Every path inside the archive, normalized to forward slashes, no leading slash. */
const entries = asar.listPackage(archive).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
const files = new Set(entries.filter((entry) => !entry.endsWith('/')))

const unpackedRoot = archive.replace(/app\.asar$/, 'app.asar.unpacked')

/** The paths Node would try for a specifier, in order. */
const candidates = (base) => [
  base,
  `${base}.js`,
  `${base}.cjs`,
  `${base}.mjs`,
  `${base}.json`,
  `${base}.node`,
  `${base}/index.js`,
  `${base}/index.cjs`,
  `${base}/index.mjs`,
  `${base}/index.json`,
  `${base}/index.node`
]

const inArchive = (base) => candidates(base).some((candidate) => files.has(candidate))
const inUnpacked = (base) => candidates(base).some((candidate) => existsSync(join(unpackedRoot, candidate)))
/** Exists in the repository, i.e. the exclusion is what removed it. */
const inSource = (base) => candidates(base).some((candidate) => existsSync(join(root, candidate)))

/**
 * A directory with a package.json is a valid require target (`require('..')`
 * from inside a package resolves to the package root). Its `main` is checked
 * separately, in the entry-point pass.
 */
const isPackageDir = (base) => files.has(`${base}/package.json`)

const shipped = (base) => inArchive(base) || inUnpacked(base) || isPackageDir(base)

/** Type-only targets are excluded from the package on purpose. */
const isTypesOnly = (target) => /\.d\.(ts|mts|cts)$/.test(target)

/** Export conditions the main process never uses (it is CommonJS). */
const SKIP_CONDITIONS = new Set(['types', 'import', 'browser', 'deno', 'development'])

const missing = []
const checked = { packages: 0, entries: 0, requires: 0, dependencies: 0, native: 0 }

// --- 1. declared entry points ---------------------------------------------
for (const file of files) {
  if (!file.startsWith('node_modules/') || !file.endsWith('/package.json')) continue
  let pkg
  try {
    pkg = JSON.parse(asar.extractFile(archive, hostPath(file)).toString('utf8'))
  } catch {
    continue
  }
  checked.packages += 1
  const base = dirname(file)
  const declared = []
  if (typeof pkg.main === 'string') declared.push(pkg.main)
  if (typeof pkg.bin === 'string') declared.push(pkg.bin)
  else if (pkg.bin && typeof pkg.bin === 'object') declared.push(...Object.values(pkg.bin))
  if (pkg.exports) {
    const walk = (value, condition) => {
      if (typeof value === 'string') {
        if (!condition || !SKIP_CONDITIONS.has(condition)) declared.push(value)
      } else if (Array.isArray(value)) {
        value.forEach((entry) => walk(entry, condition))
      } else if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value)) walk(entry, key)
      }
    }
    walk(pkg.exports, undefined)
  }
  for (const target of declared) {
    if (!target || target.includes('*') || isTypesOnly(target)) continue
    // `exports: { "./": "./" }` (tslib) normalizes to a trailing slash, which
    // no archive entry has; drop it so the package-root case is recognised.
    const normalized = normalize(`${base}/${String(target).replace(/\\/g, '/')}`).replace(/\/+$/, '')
    checked.entries += 1
    if (!shipped(normalized) && inSource(normalized)) {
      missing.push({ kind: 'entry point', from: file, target: normalized })
    }
  }
}

// --- 2. relative requires in shipped JavaScript ---------------------------
const REQUIRE = /\brequire(?:\.resolve)?\(\s*['"](\.[^'"]*)['"]\s*\)/g
const IMPORT_FROM = /\bfrom\s+['"](\.[^'"]*)['"]/g
const IMPORT_ONLY = /\bimport\s+['"](\.[^'"]*)['"]/g
// The same three, for bare specifiers (package names), used by the module-graph
// walk below.
const BARE_REQUIRE = /\brequire(?:\.resolve)?\(\s*['"]([^'"]+)['"]\s*\)/g
const BARE_FROM = /\bfrom\s+['"]([^'"]+)['"]/g
const BARE_IMPORT = /\bimport\s+['"]([^'"]+)['"]/g

for (const file of files) {
  if (!file.startsWith('node_modules/') || !/\.(cjs|mjs|js)$/.test(file)) continue
  let source
  try {
    source = asar.extractFile(archive, hostPath(file)).toString('utf8')
  } catch {
    continue
  }
  const base = dirname(file)
  for (const pattern of [REQUIRE, IMPORT_FROM, IMPORT_ONLY]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1]
      if (specifier.includes('${')) continue
      // A trailing slash survives path.normalize; drop it so `require('./')`
      // and `require('..')` compare against real archive entries.
      const target = normalize(`${base}/${specifier.replace(/\\/g, '/')}`).replace(/\/+$/, '')
      if (target.startsWith('..')) continue
      checked.requires += 1
      if (!shipped(target) && inSource(target)) {
        missing.push({ kind: 'require', from: file, target })
      }
    }
  }
}

// --- 2b. the app's own module graph resolves inside the archive ----------
// The files config removes whole packages (express, jose, @hono …). Walking
// only from the app's entry points keeps test/benchmark/install scripts in
// third-party packages out of the picture, while still following the real
// chain (main -> rapidocr-node -> yaml) that a launch actually loads.
const { builtinModules } = require('node:module')
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)])
const RUNTIME_ENTRIES = ['out/main/index.js', 'out/preload/index.js'].filter((file) => files.has(file))
if (RUNTIME_ENTRIES.length === 0) {
  // If the layout ever changes, a check that walks nothing would pass and
  // prove nothing. Fail loudly instead.
  console.error('package check: out/main/index.js is not in the archive — wrong archive, or the build layout changed')
  process.exit(2)
}

const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]

/** The directory of `name` as Node would find it from `fromFile`. */
function packageDir(fromFile, name) {
  let dir = dirname(fromFile)
  while (dir && dir !== '.') {
    const prefix = dir.endsWith('node_modules') ? `${dir}/` : `${dir}/node_modules/`
    if (files.has(`${prefix}${name}/package.json`)) return `${prefix}${name}`
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return files.has(`node_modules/${name}/package.json`) ? `node_modules/${name}` : null
}

/** The file a package's `main`/`exports` points at, if it is in the archive. */
function packageEntry(dir, name) {
  let pkg
  try {
    pkg = JSON.parse(asar.extractFile(archive, hostPath(`${dir}/package.json`)).toString('utf8'))
  } catch {
    return null
  }
  let target = typeof pkg.main === 'string' ? pkg.main : null
  if (!target && pkg.exports) {
    let value = pkg.exports
    if (value && typeof value === 'object' && !Array.isArray(value) && '.' in value) value = value['.']
    if (typeof value === 'string') target = value
    else if (value && typeof value === 'object') {
      for (const condition of ['require', 'node', 'default', 'import']) {
        if (typeof value[condition] === 'string') {
          target = value[condition]
          break
        }
      }
    }
  }
  if (!target) target = 'index.js'
  const resolved = normalize(`${dir}/${String(target).replace(/\\/g, '/')}`)
  return shipped(resolved) ? resolved : null
}

const queue = [...RUNTIME_ENTRIES]
const seen = new Set(queue)
const MAX_FILES = 20000
while (queue.length > 0 && seen.size < MAX_FILES) {
  const file = queue.shift()
  let source
  try {
    source = asar.extractFile(archive, hostPath(file)).toString('utf8')
  } catch {
    continue
  }
  const enqueue = (target) => {
    if (!target || seen.has(target)) return
    if (!/\.(cjs|mjs|js)$/.test(target)) return
    if (!shipped(target)) return
    seen.add(target)
    queue.push(target)
  }
  for (const pattern of [REQUIRE, IMPORT_FROM, IMPORT_ONLY, BARE_REQUIRE, BARE_FROM, BARE_IMPORT]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      const specifier = match[1]
      if (!specifier || specifier.includes('${')) continue
      if (specifier.startsWith('.')) {
        enqueue(normalize(`${dirname(file)}/${specifier.replace(/\\/g, '/')}`))
        continue
      }
      if (specifier.startsWith('/') || specifier.startsWith('#')) continue
      if (specifier === 'electron' || builtins.has(specifier) || builtins.has(packageName(specifier))) continue
      checked.dependencies += 1
      const name = packageName(specifier)
      const dir = packageDir(file, name)
      if (!dir) {
        if (existsSync(join(root, 'node_modules', name, 'package.json'))) {
          missing.push({ kind: 'dependency', from: file, target: name })
        }
        continue
      }
      enqueue(packageEntry(dir, name))
    }
  }
}
if (queue.length > 0) {
  console.warn(`package check: stopped after ${MAX_FILES} files; the module graph is larger than expected`)
}

// --- 3. native libraries must live outside the archive --------------------
// A dlopen() from inside an asar cannot work. electron-builder unpacks what it
// detects; a native library shipped as data in a sibling package (sharp's
// libvips) used to slip through and silently disable OCR.
const NATIVE = /\.(node|dylib|dll|so(\.\d+)*)$/i
for (const file of files) {
  if (!NATIVE.test(file)) continue
  checked.native += 1
  let stat
  try {
    stat = asar.statFile(archive, hostPath(file))
  } catch {
    continue
  }
  if (!stat.unpacked) {
    missing.push({ kind: 'native (left inside the archive)', from: file, target: file })
  }
}

// --- report ---------------------------------------------------------------
const unique = new Map()
for (const item of missing) unique.set(`${item.from} -> ${item.target}`, item)

console.log(
  `package check: ${checked.packages} packages, ${checked.entries} entry points, ${checked.requires} relative imports, ${checked.dependencies} bare imports, ${checked.native} native libraries, ${files.size} files`
)

if (unique.size > 0) {
  console.error(`package check FAILED: ${unique.size} runtime file(s) missing from ${archive}`)
  for (const item of [...unique.values()].slice(0, 60)) {
    console.error(` - ${item.kind}: ${item.from} -> ${item.target}`)
  }
  if (unique.size > 60) console.error(` ... and ${unique.size - 60} more`)
  process.exit(1)
}

console.log('package check OK')
