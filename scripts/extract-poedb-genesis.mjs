// Builds data/vendor/poedb/genesis-tree.json — the passives of the Genesis Tree — from a saved
// copy of https://poedb.tw/us/The_Genesis_Tree.
// Usage: node scripts/extract-poedb-genesis.mjs <path to the saved HTML page>
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/extract-poedb-genesis.mjs <saved The_Genesis_Tree.html>')
  process.exit(1)
}

const decode = (text) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

const html = readFileSync(file, 'utf8')
const nodes = []
// One card per passive: an icon whose class tells its kind, the name, the subtree, the stats.
for (const card of html.split('<div class="col">').slice(1)) {
  const kind = /passive-icon-type__(\w+)/.exec(card)?.[1]
  const name = /<a class="PassiveSkills"[^>]*>([^<]+)<\/a>/.exec(card)?.[1]
  const tree = /<div class="property">Genesis: <span[^>]*>([^<]+)<\/span>/.exec(card)?.[1]
  if (!kind || !name || !tree) continue
  const stats = [...card.matchAll(/<div class="implicitMod">(.*?)<\/div>/gs)].map((match) => decode(match[1])).filter(Boolean)
  nodes.push({ name: decode(name), tree: decode(tree), kind, stats })
}

writeFileSync(new URL('../data/vendor/poedb/genesis-tree.json', import.meta.url), JSON.stringify(nodes, null, 1) + '\n')
const byTree = {}
for (const node of nodes) byTree[node.tree] = (byTree[node.tree] ?? 0) + 1
console.log(`${nodes.length} passives`, byTree)
