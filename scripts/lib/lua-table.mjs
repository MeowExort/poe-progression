/**
 * Reads the Lua table literal a Path of Building data file returns into plain objects and
 * arrays. A table with only positional entries becomes an array; one with keys becomes an
 * object, its positional entries stored under 1, 2, 3… as Lua itself numbers them.
 */
export function parseLua(source) {
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
    if (!hasKeys) return listed
    listed.forEach((entry, i) => (keyed[i + 1] = entry))
    return keyed
  }
  skip()
  if (!source.startsWith('return', at)) fail('expected return')
  at += 'return'.length
  return value()
}

/** The positional entries of a parsed table, in order. */
export function positional(table) {
  if (Array.isArray(table)) return table
  const entries = []
  for (let i = 1; table && table[i] !== undefined; i++) entries.push(table[i])
  return entries
}
