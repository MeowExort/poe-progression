// Builds data/vendor/pob/tree.json — the passive tree as a graph — from a Path of Building
// checkout. Usage: node scripts/extract-pob-tree.mjs <path to tree.lua> <version label>
import { readFileSync, writeFileSync } from 'node:fs'
import { parseLua } from './lib/lua-table.mjs'

const [file, version] = process.argv.slice(2)
if (!file || !version) {
  console.error('usage: node scripts/extract-pob-tree.mjs <TreeData/<version>/tree.lua> <version, e.g. 3_30>')
  process.exit(1)
}

const tree = parseLua(readFileSync(file, 'utf8'))
const list = (value) => (Array.isArray(value) ? value : value ? Object.values(value) : [])

const nodes = {}
for (const node of Object.values(tree.nodes)) {
  if (typeof node.skill !== 'number') continue
  const links = [...new Set([...list(node.out), ...list(node.in)].map(Number))].filter((id) => id !== node.skill)
  // Cluster jewel sockets hang off the tree by proxy nodes that cannot be allocated.
  if (node.isProxy) continue
  const kind = node.classStartIndex !== undefined
    ? 'start'
    : node.isAscendancyStart
      ? 'ascendancyStart'
      : node.isKeystone
        ? 'keystone'
        : node.isMastery
          ? 'mastery'
          : node.isJewelSocket
            ? 'jewel'
            : node.isNotable
              ? 'notable'
              : 'small'
  const entry = { name: node.name ?? '', kind, links }
  if (node.ascendancyName) entry.ascendancy = node.ascendancyName
  if (node.classStartIndex !== undefined) entry.classStart = node.classStartIndex
  const stats = list(node.stats).map((line) => String(line).replace(/\s*\n\s*/g, ' '))
  if (stats.length && kind !== 'start') entry.stats = stats
  if (node.isMastery) {
    entry.effects = Object.fromEntries(
      list(node.masteryEffects).map((effect) => [effect.effect, list(effect.stats).map((line) => String(line).replace(/\s*\n\s*/g, ' '))])
    )
  }
  nodes[node.skill] = entry
}
// A mastery can be taken once any notable of its cluster is: link it to all of them.
const byGroup = new Map()
for (const node of Object.values(tree.nodes)) {
  if (typeof node.skill !== 'number' || node.group === undefined || !nodes[node.skill]) continue
  byGroup.set(node.group, [...(byGroup.get(node.group) ?? []), node.skill])
}
for (const node of Object.values(tree.nodes)) {
  if (!node.isMastery || !nodes[node.skill]) continue
  const notables = (byGroup.get(node.group) ?? []).filter((id) => nodes[id].kind === 'notable')
  nodes[node.skill].links = [...new Set([...nodes[node.skill].links, ...notables])]
  for (const id of notables) nodes[id].links = [...new Set([...nodes[id].links, node.skill])]
}
// Links only between nodes that are kept.
for (const node of Object.values(nodes)) node.links = node.links.filter((id) => nodes[id]).sort((a, b) => a - b)

const classes = list(tree.classes).map((entry, index) => ({
  name: entry.name,
  start: +Object.keys(nodes).find((id) => nodes[id].classStart === index),
  ascendancies: list(entry.ascendancies).map((ascendancy) => ascendancy.id ?? ascendancy.name)
}))

const out = new URL('../data/vendor/pob/tree.json', import.meta.url)
writeFileSync(out, JSON.stringify({ version, classes, nodes }))
const kinds = {}
for (const node of Object.values(nodes)) kinds[node.kind] = (kinds[node.kind] ?? 0) + 1
console.log(`tree ${version}: ${Object.keys(nodes).length} nodes`, kinds)
console.log(classes.map((entry) => `${entry.name}@${entry.start} [${entry.ascendancies.join(', ')}]`).join('\n'))
