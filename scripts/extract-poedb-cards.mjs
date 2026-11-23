// Builds data/vendor/poedb/divination-cards.json from a saved copy of
// https://poedb.tw/us/Divination_Cards
// Usage: node scripts/extract-poedb-cards.mjs <saved html file>
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2]
if (!file) {
  console.error('usage: node scripts/extract-poedb-cards.mjs <Divination_Cards.html>')
  process.exit(1)
}

const decode = (text) =>
  text
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

const html = readFileSync(file, 'utf8')
const pattern =
  /<a class="divination DivinationCard"[^>]*href="([^"]+)">([^<]+)<\/a><div><div class="property">Stack Size: <span[^>]*>([^<]*)<\/span><\/div><div class="separator"><\/div><div class="explicitMod">(.*?)<\/div><\/div>/gs

const cards = new Map()
for (const [, href, rawName, stack, mod] of html.matchAll(pattern)) {
  const name = decode(rawName).trim()
  if (cards.has(name)) continue
  const lines = mod.split(/<br\s*\/?>/)
  const kind = /<span class="([a-z]+)">/.exec(lines[0])?.[1] ?? 'default'
  const card = {
    name,
    stack: +(/\/\s*(\d+)/.exec(stack)?.[1] ?? 1),
    reward: text(lines[0]),
    // unique | white | rare | magic | gem | currency | other
    kind: { uniqueitem: 'unique', whiteitem: 'white', rareitem: 'rare', magicitem: 'magic', gemitem: 'gem', currencyitem: 'currency' }[kind] ?? 'other',
    page: href
  }
  const details = lines.slice(1).map(text).filter(Boolean)
  if (details.length) card.details = details
  cards.set(name, card)
}

const sorted = [...cards.values()].sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(
  new URL('../data/vendor/poedb/divination-cards.json', import.meta.url),
  JSON.stringify(sorted, null, 1) + '\n'
)
console.log(`${sorted.length} cards`)
