// Builds data/vendor/pob/{uniques,bases}.json from a Path of Building checkout.
// Usage: node scripts/extract-pob-data.mjs <path to PathOfBuilding repository>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/extract-pob-data.mjs <PathOfBuilding checkout>')
  process.exit(1)
}

const out = new URL('../data/vendor/pob/', import.meta.url)
const luaFiles = (dir) => readdirSync(dir).filter((file) => file.endsWith('.lua')).sort()

// "unique{The Shaper}" and similar colour markers become plain text.
const plain = (text) => text.replace(/\b[A-Za-z]+\{([^}]*)\}/g, '$1').trim()

const uniques = new Map()
const uniquesDir = join(root, 'src/Data/Uniques')
for (const file of luaFiles(uniquesDir)) {
  const source = readFileSync(join(uniquesDir, file), 'utf8')
  for (const [, block] of source.matchAll(/\[\[\r?\n([\s\S]*?)\]\]/g)) {
    const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    const name = lines[0]
    // A unique that exists on several bases lists each as "{variant:1,2}Base": take the first.
    const base = lines[1]?.replace(/^\{[^}]*\}/, '')
    if (!name || !base || uniques.has(name)) continue
    const entry = { name, base }
    for (const line of lines.slice(2)) {
      const league = /^League: (.+)$/.exec(line)
      const from = /^Source: (.+)$/.exec(line)
      const level = /^(?:Requires Level|LevelReq:) (\d+)/.exec(line)
      if (league && !entry.league) entry.league = league[1]
      // Variants of one unique can have different sources: keep them all.
      if (from) entry.source = entry.source ? `${entry.source}; ${plain(from[1])}` : plain(from[1])
      if (level && !entry.level) entry.level = +level[1]
    }
    uniques.set(name, entry)
  }
}

const bases = {}
const basesDir = join(root, 'src/Data/Bases')
for (const file of luaFiles(basesDir)) {
  const source = readFileSync(join(basesDir, file), 'utf8')
  for (const [, name, body] of source.matchAll(/itemBases\["([^"]+)"\] = \{([\s\S]*?)\n\}/g)) {
    const type = /\btype = "([^"]+)"/.exec(body)?.[1]
    if (!type) continue
    const level = /\breq = \{[^}]*\blevel = (\d+)/.exec(body)?.[1]
    // For armour pieces: which defences the base has, e.g. "Armour/Evasion".
    const sub = /\bsubType = "([^"]+)"/.exec(body)?.[1]
    bases[name] = { type, level: level ? +level : 1, ...(sub ? { sub } : {}) }
  }
}

const sorted = [...uniques.values()].sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(new URL('uniques.json', out), JSON.stringify(sorted, null, 1) + '\n')
writeFileSync(new URL('bases.json', out), JSON.stringify(bases, null, 1) + '\n')
console.log(`${sorted.length} uniques, ${Object.keys(bases).length} bases`)
