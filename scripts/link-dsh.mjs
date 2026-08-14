#!/usr/bin/env node
/**
 * Link the installed DSH closure into this repo's node_modules so dev tools
 * (tsc, vitest) can resolve @deepseek-ai/dsh-* and cordis — the same way a
 * profile resolves them at runtime (healed $DSH_HOME/profiles/node_modules).
 *
 * WHY this exists: the dsh-* packages are private and never installed from a
 * registry; the active checkout (~/.dsh/source/current) is the only source.
 * Discovery, not hardcoding: for every peer name we search the checkout's
 * packages/ tree for the package whose manifest name matches, and link its
 * real directory (its transitive deps resolve inside the checkout's store).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const home = process.env.HOME ?? ''
const checkoutCandidates = [
  process.env.DSH_SOURCE !== undefined ? join(process.env.DSH_SOURCE, 'current') : null,
  join(home, '.dsh', 'source', 'current'),
].filter((p) => p !== null)
const checkout = checkoutCandidates.find((p) => existsSync(join(p, 'package.json')))
if (checkout === undefined) {
  console.error('link-dsh: no DSH checkout found (tried $DSH_SOURCE/current, ~/.dsh/source/current)')
  process.exit(1)
}

const isDir = (p) => { try { return statSync(p).isDirectory() } catch { return false } }
const readdir = (p) => { try { return readdirSync(p) } catch { return [] } }
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

// Read peer names from our manifest.
const manifest = readJson(join(repoRoot, 'package.json'))
const scopePeers = Object.keys(manifest.peerDependencies ?? {}).filter((n) => n.startsWith('@deepseek-ai/'))
const plainPeers = ['cordis', 'schemastery', '@cordisjs']

/** Find the package dir under the checkout whose manifest name matches. */
function findPackageDir(name) {
  const stack = [join(checkout, 'packages')]
  const seen = new Set()
  while (stack.length > 0) {
    const dir = stack.pop()
    if (seen.has(dir)) continue
    seen.add(dir)
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) {
      try {
        if (readJson(manifestPath).name === name) return dir
      } catch { /* keep walking */ }
    }
    for (const entry of readdir(dir)) {
      const p = join(dir, entry)
      if (isDir(p) && entry !== 'node_modules' && entry !== 'lib' && !entry.startsWith('.')) stack.push(p)
    }
  }
  return undefined
}

/** Plain-dependency resolution: closure dir, root store, vendor workspace, or .pnpm store. */
function findPlainDir(name) {
  for (const base of [join(checkout, 'apps', 'cli', 'node_modules'), join(checkout, 'node_modules')]) {
    const p = join(base, name)
    if (existsSync(p)) return p
  }
  // vendored workspace members (schemastery and friends)
  for (const entry of readdir(join(checkout, 'vendor'))) {
    const p = join(checkout, 'vendor', entry)
    if (entry === name && isDir(p)) return p
  }
  const store = join(checkout, 'node_modules', '.pnpm')
  if (isDir(store)) {
    const key = name.startsWith('@') ? name.slice(1).replace('/', '+') : name
    for (const entry of readdir(store)) {
      if (entry.startsWith(key + '@')) {
        const p = join(store, entry, 'node_modules', name)
        if (existsSync(p)) return p
      }
    }
  }
  return undefined
}

const nm = join(repoRoot, 'node_modules')
mkdirSync(nm, { recursive: true })
const linked = []
for (const name of scopePeers) {
  const src = findPackageDir(name)
  if (src === undefined) { console.warn(`link-dsh: ${name} not found under packages/ — skipping`); continue }
  const dst = join(nm, ...name.split('/'))
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dirname(dst), { recursive: true })
  symlinkSync(src, dst, 'dir')
  linked.push(`${name} -> ${src}`)
}
for (const name of plainPeers) {
  const src = findPlainDir(name)
  if (src === undefined) { console.warn(`link-dsh: ${name} not found in closure — skipping`); continue }
  const dst = join(nm, ...name.split('/'))
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dirname(dst), { recursive: true })
  symlinkSync(src, dst, 'dir')
  linked.push(`${name} -> ${src}`)
}
console.log(`link-dsh: linked ${linked.length} packages from ${checkout}`)
for (const line of linked) console.log(`  ${line}`)
