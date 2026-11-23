// Builds data/vendor/pob/tree.json — the passive tree as a graph — from a Path of Building
// checkout. Usage: node scripts/extract-pob-tree.mjs <path to tree.lua> <version label>
import { readFileSync, writeFileSync } from 'node:fs'

const [file, version] = process.argv.slice(2)
if (!file || !version) {
  console.error('usage: node scripts/extract-pob-tree.mjs <TreeData/<version>/tree.lua> <version, e.g. 3_30>')
  process.exit(1)
}

/** Reads a Lua table literal (what tree.lua returns) into plain objects and arrays. */
function parseLua(source) {
  let at = 0
  const fail = (what) => {
    throw new Error(`${what} at offset ${at}: ${JSON.stringify(source.slice(at, at + 40))}`)
  }
  const skip = () => {
    for (;;) {
      while (at < source.length && /\s/.test(source[at])) at++
      if (source.startsWith('--', at)) at = source.indexOf('\n', at) === -1 ? source.length : source.indexOf('\n', at)
      else return
    }
  }
  const string = () => {
    const quote = source[at++]
    let text = ''
    while (source[at] !== quote) {
      if (at >= source.length) fail('unterminated string')
      if (source[at] === '\\') {
        const next = source[++at]
        if (next === 'n' || next === '\n') text += '\n'
        else if (next === 'r' || next === '\r') text += ''
        else if (next === 't') text += '\t'
        else if (/\d/.test(next)) {
          const digits = /^\d{1,3}/.exec(source.slice(at, at + 3))[0]
          text += String.fromCharCode(+digits)
          at += digits.length - 1
        } else text += next
        at++
      } else text += source[at++]
    }
    at++
    return text
  }
  const value = () => {
    skip()
    const char = source[at]
    if (char === '{') return table()
    if (char === '"' || char === "'") return string()
    const word = /^(-?\d+(\.\d+)?(e[+-]?\d+)?|true|false|nil)/i.exec(source.slice(at, at + 40))
    if (!word) fail('unexpected value')
    at += word[0].length
    if (word[0] === 'true') return true
    if (word[0] === 'false') return false
    if (word[0] === 'nil') return null
    return +word[0]
  }
  const table = () => {
    at++ // {
    const keyed = {}
    const listed = []
    let hasKeys = false
    for (;;) {
      skip()
      if (source[at] === '}') {
        at++
        break
      }
      if (source[at] === '[') {
        at++
        const key = value()
        skip()
        if (source[at++] !== ']') fail('expected ]')
        skip()
        if (source[at++] !== '=') fail('expected =')
        keyed[key] = value()
        hasKeys = true
      } else {
        const name = /^([A-Za-z_]\w*)\s*=/.exec(source.slice(at, at + 80))
        if (name) {
          at += name[0].length
          keyed[name[1]] = value()
          hasKeys = true
        } else listed.push(value())
      }
      skip()
      if (source[at] === ',' || source[at] === ';') at++
    }
    return hasKeys ? keyed : listed
  }
  skip()
  if (!source.startsWith('return', at)) fail('expected return')
  at += 'return'.length
  return value()
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
