import type { LogEvent } from '@shared/events'

/**
 * A Client.txt line looks like:
 *   2026/11/22 18:04:11 123456789 cff945b9 [INFO Client 12345] : You have entered The Coast.
 * i.e. date, time, uptime ms, source hash, [LEVEL Client pid], message.
 */
const LINE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) \d+ [0-9a-f]+ \[(\w+) Client \d+\] (.*)$/

const AREA_GENERATED = /^Generating level (\d+) area "([^"]+)" with seed (\d+)/
const AREA_ENTERED = /^: You have entered (.+)\.$/
const LEVEL_UP = /^: (.+?) \(([A-Za-z]+)\) is now level (\d+)$/
const DEATH = /^: (.+?) has been slain\.$/
const AFK = /^: AFK mode is now (ON|OFF)/
/** "#" global, "$" trade, "%" party, "&" guild, "@From"/"@To" whispers. Never kept. */
const CHAT = /^(?:[#$%&]|@(?:From|To) )/
/** "Speaker: text". The speaker may contain spaces and commas ("Sirus, Awakener of Worlds"). */
const DIALOGUE = /^(?:<[^>]*> )?([^:]{1,60}): (.+)$/

export type ParseResult =
  | { kind: 'event'; event: LogEvent }
  /** Recognised as noise: chat, engine debug output, blank lines. */
  | { kind: 'ignored' }

const IGNORED: ParseResult = { kind: 'ignored' }

export function parseLine(line: string): ParseResult {
  const m = LINE.exec(line)
  if (!m) return IGNORED

  const ts = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  const level = m[7]
  const message = m[8]

  const generated = AREA_GENERATED.exec(message)
  if (generated) {
    return event({ type: 'area_generated', ts, level: +generated[1], areaId: generated[2], seed: generated[3] })
  }

  // Everything else of interest is written at INFO level; the rest is engine noise.
  if (level !== 'INFO') return IGNORED

  if (message.startsWith(': ')) {
    const entered = AREA_ENTERED.exec(message)
    if (entered) return event({ type: 'area_entered', ts, name: entered[1] })

    const levelUp = LEVEL_UP.exec(message)
    if (levelUp) {
      return event({ type: 'level_up', ts, character: levelUp[1], class: levelUp[2], level: +levelUp[3] })
    }

    const death = DEATH.exec(message)
    if (death) return event({ type: 'death', ts, character: death[1] })

    const afk = AFK.exec(message)
    if (afk) return event({ type: 'afk', ts, on: afk[1] === 'ON' })

    return event({ type: 'system', ts, text: message.slice(2) })
  }

  if (CHAT.test(message)) return IGNORED

  const dialogue = DIALOGUE.exec(message)
  if (dialogue) return event({ type: 'dialogue', ts, speaker: dialogue[1], text: dialogue[2] })

  return IGNORED
}

function event(e: LogEvent): ParseResult {
  return { kind: 'event', event: e }
}
