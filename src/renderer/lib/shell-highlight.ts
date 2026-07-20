const COMMAND_WORDS = new Set([
  'echo',
  'cd',
  'rm',
  'ssh',
  'scp',
  'tar',
  'npm',
  'pnpm',
  'yarn',
  'cp',
  'mv',
  'mkdir',
  'chmod',
  'chown',
  'export',
  'source',
  'sudo',
  'curl',
  'wget',
  'rsync',
  'docker',
  'git',
  'cat',
  'grep',
  'sed',
  'awk',
  'find',
  'xargs',
  'tee',
  'touch',
  'ln',
  'ls',
  'pwd',
  'exit',
  'return',
  'bash',
  'sh',
  'exec',
  'nohup',
  'kill',
  'sleep',
  'date'
])

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isCommandPosition(line: string, index: number): boolean {
  const before = line.slice(0, index).trimEnd()
  if (!before) return true
  return /(\||&&|\|\||;)\s*$/.test(before)
}

function readQuotedString(line: string, start: number): { end: number } {
  const quote = line[start]
  let i = start + 1
  while (i < line.length) {
    if (line[i] === '\\') {
      i += 2
      continue
    }
    if (line[i] === quote) return { end: i + 1 }
    i += 1
  }
  return { end: line.length }
}

function readVariable(line: string, start: number): { end: number } {
  if (line[start + 1] === '{') {
    const close = line.indexOf('}', start + 2)
    return { end: close >= 0 ? close + 1 : line.length }
  }
  if (line[start + 1] === '(') {
    let depth = 1
    let i = start + 2
    while (i < line.length && depth > 0) {
      if (line[i] === '(') depth += 1
      else if (line[i] === ')') depth -= 1
      i += 1
    }
    return { end: i }
  }
  const match = /^\$[a-zA-Z_][a-zA-Z0-9_]*/.exec(line.slice(start))
  return { end: start + (match?.[0].length || 1) }
}

function highlightShellLine(line: string): string {
  let out = ''
  let i = 0
  let commandPosition = isCommandPosition(line, 0)

  while (i < line.length) {
    const rest = line.slice(i)

    if (line[i] === '#') {
      out += `<span class="sh-comment">${escapeHtml(rest)}</span>`
      break
    }

    if (line[i] === '"' || line[i] === "'") {
      const { end } = readQuotedString(line, i)
      out += `<span class="sh-string">${escapeHtml(line.slice(i, end))}</span>`
      i = end
      commandPosition = false
      continue
    }

    if (/\s/.test(line[i])) {
      out += line[i]
      i += 1
      commandPosition = isCommandPosition(line, i)
      continue
    }

    if (line[i] === '$') {
      const { end } = readVariable(line, i)
      out += `<span class="sh-variable">${escapeHtml(line.slice(i, end))}</span>`
      i = end
      commandPosition = false
      continue
    }

    if (line[i] === '-' && /[a-zA-Z]/.test(line[i + 1] || '')) {
      const match = /^-[a-zA-Z0-9]+/.exec(rest)
      if (match) {
        out += `<span class="sh-flag">${escapeHtml(match[0])}</span>`
        i += match[0].length
        commandPosition = false
        continue
      }
    }

    if ('|;&'.includes(line[i])) {
      out += `<span class="sh-operator">${escapeHtml(line[i])}</span>`
      i += 1
      commandPosition = isCommandPosition(line, i)
      continue
    }

    if ('<>'.includes(line[i])) {
      const redirect = /^>{1,2}/.exec(rest)
      if (redirect) {
        out += `<span class="sh-operator">${escapeHtml(redirect[0])}</span>`
        i += redirect[0].length
        commandPosition = false
        continue
      }
    }

    const wordMatch = /^[a-zA-Z0-9_./:@+-]+/.exec(rest)
    if (wordMatch) {
      const word = wordMatch[0]
      if (commandPosition && COMMAND_WORDS.has(word)) {
        out += `<span class="sh-command">${escapeHtml(word)}</span>`
      } else if (word.includes('/') || word.includes('@') || word.includes('.')) {
        out += `<span class="sh-path">${escapeHtml(word)}</span>`
      } else if (/^\d/.test(word)) {
        out += `<span class="sh-number">${escapeHtml(word)}</span>`
      } else {
        out += escapeHtml(word)
      }
      i += word.length
      commandPosition = false
      continue
    }

    out += escapeHtml(line[i])
    i += 1
    commandPosition = false
  }

  return out
}

export function highlightShellPlainText(text: string): string {
  if (!text) return ''
  return text.split('\n').map((line) => highlightShellLine(line)).join('\n')
}
