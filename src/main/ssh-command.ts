import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SshKeyConfig } from '../shared/types'
import { getSshKeyFilePath } from './ssh-key-store'

export function resolveSshKeyPath(keyId: string | undefined, sshKeys: SshKeyConfig[] | undefined): string | undefined {
  if (!keyId?.trim()) return undefined
  const id = keyId.trim()
  const known = sshKeys?.some((item) => item.id === id)
  if (!known) return undefined
  const path = getSshKeyFilePath(id)
  return existsSync(path) ? path : undefined
}

export function injectSshIdentity(command: string, keyPath: string): string {
  const trimmed = command.trim()
  if (!/^\s*ssh(\s|$)/i.test(trimmed)) return command

  const withoutIdentity = trimmed
    .replace(/(?:^|\s)-i\s+(?:"[^"]+"|'[^']+'|\S+)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return withoutIdentity.replace(/^(\s*ssh)\b/i, `$1 -i "${keyPath}"`)
}

export function resolveCommandWithSshKey(
  command: string,
  sshKeyId: string | undefined,
  sshKeys: SshKeyConfig[] | undefined
): string {
  const keyPath = resolveSshKeyPath(sshKeyId, sshKeys)
  if (!keyPath) return command

  return command
    .split('|||')
    .map((segment) => injectSshIdentity(segment.trim(), keyPath))
    .join(' ||| ')
}

export function resolveCommandConfigCommand(
  command: string,
  sshKeyId: string | undefined,
  sshKeys: SshKeyConfig[] | undefined
): string {
  return resolveCommandWithSshKey(command, sshKeyId, sshKeys)
}

export function prepareManagedSshCommand(commandLine: string, promptMarker: string): string | undefined {
  if (!existsSync('/usr/bin/ssh')) return undefined
  const tokens = parseLiteralShellWords(commandLine)
  if (!tokens || tokens[0] !== 'ssh') return undefined
  const connectionArgs = parseSshConnectionArgs(tokens.slice(1))
  if (!connectionArgs) return undefined

  const prompt = `${promptMarker}$ `
  const remoteShell = `/usr/bin/env -u ENV -u BASH_ENV -u ZDOTDIR -u PROMPT_COMMAND HISTFILE=/dev/null PS1=${quotePosixShellArgument(prompt)} /bin/sh -i`
  const args = [...connectionArgs, remoteShell]
  return `/usr/bin/ssh -tt ${args.map(quotePosixShellArgument).join(' ')}`
}

const SSH_FLAGS = new Set('46AaCGgKkMnqtVvXxYy')
const SSH_OPTIONS_WITH_VALUE = new Set('BbcdEeFIiJLlmoPpRSw')
const UNSUPPORTED_SSH_CONFIG = new Set([
  'localcommand',
  'permitlocalcommand',
  'remotecommand',
  'requesttty',
  'sessiontype',
  'stdinnull'
])

function parseSshConnectionArgs(tokens: string[]): string[] | undefined {
  const result: string[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') {
      if (index + 2 !== tokens.length) return undefined
      return [...result, tokens[index + 1]]
    }
    if (!token.startsWith('-') || token === '-') {
      if (index !== tokens.length - 1) return undefined
      return [...result, token]
    }
    if (!/^-[A-Za-z0-9].*/u.test(token)) return undefined
    const option = token[1]
    if (SSH_FLAGS.has(option)) {
      if (![...token.slice(1)].every((flag) => SSH_FLAGS.has(flag))) return undefined
      result.push(token)
      continue
    }
    if (!SSH_OPTIONS_WITH_VALUE.has(option)) return undefined
    let value = token.slice(2)
    result.push(token)
    if (!value) {
      value = tokens[index + 1]
      if (!value) return undefined
      result.push(value)
      index += 1
    }
    if (option === 'o') {
      const configName = value.split(/[=\s]/u, 1)[0].toLowerCase()
      if (UNSUPPORTED_SSH_CONFIG.has(configName)) return undefined
    }
  }
  return undefined
}

function parseLiteralShellWords(input: string): string[] | undefined {
  const words: string[] = []
  let word = ''
  let quote: "'" | '"' | undefined
  let started = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (quote) {
      if (character === quote) {
        quote = undefined
      } else if (character === '\\' && quote === '"') {
        index += 1
        if (index >= input.length) return undefined
        word += input[index]
      } else {
        word += character
      }
      started = true
      continue
    }
    if (/\s/u.test(character)) {
      if (started) words.push(word)
      word = ''
      started = false
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      started = true
      continue
    }
    if (character === '\\') {
      index += 1
      if (index >= input.length) return undefined
      word += input[index]
      started = true
      continue
    }
    if (/[\u0000-\u001F\u007F;&|<>`$(){}*?!]/u.test(character)) return undefined
    word += character
    started = true
  }
  if (quote) return undefined
  if (started) words.push(word)
  return words
}

function quotePosixShellArgument(value: string): string {
  return `'${value.replace(/'/gu, `'"'"'`)}'`
}
