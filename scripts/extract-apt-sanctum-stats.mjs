// Builds data/vendor/apt/sanctum-stats.json from an Awakened PoE Trade checkout:
// the Sanctum relic modifiers with the ids the official trade site knows them by.
// Usage: node scripts/extract-apt-sanctum-stats.mjs <path to awakened-poe-trade repository>
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) {
  console.error('usage: node scripts/extract-apt-sanctum-stats.mjs <awakened-poe-trade checkout>')
  process.exit(1)
}

const stats = []
for (const line of readFileSync(join(root, 'renderer/public/data/en/stats.ndjson'), 'utf8').split('\n')) {
  if (!line.includes('sanctum.stat_')) continue
  const row = JSON.parse(line)
  const id = Object.values(row.trade?.ids ?? {}).flat().find((value) => value.startsWith('sanctum.'))
  if (!id || !Array.isArray(row.matchers)) continue
  stats.push({
    id,
    ref: row.ref,
    // 1: a higher value is better, -1: a lower one is, 0: there is no better.
    better: row.better ?? 0,
    matchers: row.matchers.map((matcher) => ({
      string: matcher.string,
      ...(matcher.value !== undefined ? { value: matcher.value } : {}),
      ...(matcher.negate ? { negate: true } : {})
    }))
  })
}

stats.sort((a, b) => a.ref.localeCompare(b.ref))
writeFileSync(new URL('../data/vendor/apt/sanctum-stats.json', import.meta.url), JSON.stringify(stats, null, 1) + '\n')
console.log(`${stats.length} relic modifiers`)
