// Prints the section of CHANGELOG.md for one version: the text of its GitHub release,
// which the app shows when it offers the update.
// Usage: node scripts/release-notes.mjs <version>
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: node scripts/release-notes.mjs <version>')
  process.exit(1)
}

const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/)
const start = lines.findIndex((line) => line.startsWith(`## ${version}`))
if (start === -1) {
  console.error(`CHANGELOG.md has no section "## ${version}": write one before releasing.`)
  process.exit(1)
}
const rest = lines.slice(start + 1)
const end = rest.findIndex((line) => line.startsWith('## '))
const notes = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
if (!notes) {
  console.error(`The section "## ${version}" of CHANGELOG.md is empty.`)
  process.exit(1)
}
console.log(notes)
