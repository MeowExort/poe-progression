// Builds data/vendor/pob/mods.json — the modifiers rare items can have, and the ways to force
// them — from a Path of Building checkout.
// Usage: node scripts/extract-pob-mods.mjs <path to PathOfBuilding repository>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseLua, positional } from './lib/lua-table.mjs'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/extract-pob-mods.mjs <PathOfBuilding checkout>')
  process.exit(1)
}
const load = (name) => parseLua(readFileSync(join(root, 'src/Data', `${name}.lua`), 'utf8'))
const list = (value) => (Array.isArray(value) ? value : value ? positional(value) : [])
const oneLine = (text) => String(text).replace(/\s*\n\s*/g, ' / ')

/** A modifier in the compact form the app reads. */
function compact(mod, source) {
  const keys = list(mod.weightKey)
  const values = list(mod.weightVal)
  const entry = {
    type: mod.type,
    stats: positional(mod).map(oneLine),
    level: mod.level ?? 1,
    group: mod.group ?? '',
    tags: list(mod.modTags)
  }
  if (keys.length) entry.weights = keys.map((key, i) => [key, values[i] ?? 0])
  if (source) entry.source = source
  return entry
}

const mods = {}
const isAffix = (mod) => mod && (mod.type === 'Prefix' || mod.type === 'Suffix') && positional(mod).length > 0
for (const [id, mod] of Object.entries(load('ModExplicit'))) if (isAffix(mod)) mods[id] = compact(mod, null)
for (const [id, mod] of Object.entries(load('ModVeiled'))) if (isAffix(mod)) mods[id] = compact(mod, 'veiled')
for (const [id, mod] of Object.entries(load('ModDelve'))) if (isAffix(mod)) mods[id] = compact(mod, 'delve')

// Essences name a modifier per item type; a few of those exist on essences alone.
const exclusive = load('ModItemExclusive')
const essences = []
for (const essence of Object.values(load('Essence'))) {
  if (!essence.name || !essence.mods) continue
  const byType = {}
  for (const [type, id] of Object.entries(essence.mods)) {
    if (!mods[id] && isAffix(exclusive[id])) mods[id] = compact(exclusive[id], 'essence')
    if (mods[id]) byType[type] = id
  }
  essences.push({ name: essence.name, tier: essence.tier ?? 0, mods: byType })
}
essences.sort((a, b) => a.name.localeCompare(b.name))

const bench = list(load('ModMaster'))
  .filter(isAffix)
  .map((mod) => ({ ...compact(mod, null), types: Object.keys(mod.types ?? {}).sort() }))

const out = new URL('../data/vendor/pob/mods.json', import.meta.url)
writeFileSync(out, JSON.stringify({ mods, essences, bench }))
const count = (source) => Object.values(mods).filter((mod) => (mod.source ?? null) === source).length
console.log(
  `${Object.keys(mods).length} modifiers (${count(null)} ordinary, ${count('veiled')} veiled, ${count('delve')} delve, ${count('essence')} essence-only), ` +
    `${essences.length} essences, ${bench.length} bench crafts`
)
