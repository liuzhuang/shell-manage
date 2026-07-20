import { basename } from 'node:path'
import type { ProjectDirectory } from '../shared/types'

export interface ScriptToTemplateResult {
  content: string
  sshKeyRef?: string
  matchedProjectId?: string
  replacements: Array<{ from: string; slot: string }>
}

export interface ScriptToTemplateParams {
  script: string
  projectDirectories: ProjectDirectory[]
  sshKeys: Array<{ id: string; path: string; label: string }>
}

interface ScriptToTemplateReplacement {
  from: string
  to: string
  slot: string
}

const SSH_KEY_FLAG_RE = /(?:^|\s)-i\s+([^\s"']+)/gm
const SSH_KEY_ASSIGN_RE = /(?:^|\n)\s*(?:export\s+)?SSH_KEY\s*=\s*["']([^"']+)["']/gm

function slotToken(name: string): string {
  return `{{${name.trim()}}}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function collectSshKeyPaths(script: string): string[] {
  const values = new Set<string>()
  SSH_KEY_FLAG_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SSH_KEY_FLAG_RE.exec(script)) !== null) {
    values.add(match[1].trim())
  }
  SSH_KEY_ASSIGN_RE.lastIndex = 0
  while ((match = SSH_KEY_ASSIGN_RE.exec(script)) !== null) {
    values.add(match[1].trim())
  }
  return [...values]
}

function addSshKeyReplacements(
  script: string,
  keys: ScriptToTemplateParams['sshKeys'],
  replacements: ScriptToTemplateReplacement[]
): string | undefined {
  let sshKeyRef: string | undefined
  const scriptKeyPaths = collectSshKeyPaths(script)

  for (const scriptPath of scriptKeyPaths) {
    const key = findMatchingKey(scriptPath, keys)
    if (!key || !key.label.trim()) continue
    replacements.push({ from: scriptPath, to: slotToken(key.label), slot: key.label.trim() })
    if (!sshKeyRef) sshKeyRef = key.id
  }

  if (!sshKeyRef && scriptKeyPaths.length > 0 && keys.length > 0) {
    const fallback = keys[0]
    const fallbackLabel = fallback.label.trim()
    if (fallbackLabel) {
      for (const scriptPath of scriptKeyPaths) {
        replacements.push({ from: scriptPath, to: slotToken(fallbackLabel), slot: fallbackLabel })
      }
      sshKeyRef = fallback.id
    }
  }

  SSH_KEY_ASSIGN_RE.lastIndex = 0
  let assignMatch: RegExpExecArray | null
  while ((assignMatch = SSH_KEY_ASSIGN_RE.exec(script)) !== null) {
    const scriptPath = assignMatch[1].trim()
    const key = findMatchingKey(scriptPath, keys) || keys[0]
    const label = key?.label.trim()
    if (!label) continue
    const token = slotToken(label)
    replacements.push({
      from: assignMatch[0],
      to: assignMatch[0].replace(scriptPath, token),
      slot: label
    })
    if (!sshKeyRef && key) sshKeyRef = key.id
  }

  return sshKeyRef
}

function addRelativeProjectNameReplacements(
  script: string,
  projects: ProjectDirectory[],
  replacements: ScriptToTemplateReplacement[]
): string | undefined {
  let matchedProjectId: string | undefined
  const ordered = [...projects].sort((a, b) => b.name.trim().length - a.name.trim().length)

  for (const project of ordered) {
    const name = project.name.trim()
    if (!name || name.includes('{{')) continue
    const token = slotToken(name)
    let matched = false

    const quotedDouble = `"${name}"`
    if (script.includes(quotedDouble)) {
      replacements.push({ from: quotedDouble, to: `"${token}"`, slot: name })
      matched = true
    }
    const quotedSingle = `'${name}'`
    if (script.includes(quotedSingle)) {
      replacements.push({ from: quotedSingle, to: `'${token}'`, slot: name })
      matched = true
    }
    if (script.includes(`cd ${name}`)) {
      replacements.push({ from: `cd ${name}`, to: `cd ${token}`, slot: name })
      matched = true
    }

    if (matched && !matchedProjectId) matchedProjectId = project.id
  }

  return matchedProjectId
}

function matchesKeyPath(scriptPath: string, key: { id: string; path: string }): boolean {
  const normalized = scriptPath.trim()
  const storePath = key.path.trim()
  if (!normalized || !storePath) return false
  if (normalized === storePath) return true

  const normalizeStem = (value: string): string => {
    return basename(value)
      .replace(/\.(pem|key|ppk)$/i, '')
      .trim()
      .toLowerCase()
  }

  const scriptStem = normalizeStem(normalized)
  const storeStem = normalizeStem(storePath)
  const keyStem = key.id.trim().toLowerCase()
  if (!scriptStem) return false
  if (scriptStem === storeStem) return true
  if (scriptStem === keyStem) return true
  if (keyStem.startsWith(`${scriptStem}-`) || keyStem.endsWith(`-${scriptStem}`)) return true
  return keyStem.includes(scriptStem)
}

function findMatchingKey(
  scriptPath: string,
  keys: ScriptToTemplateParams['sshKeys']
): ScriptToTemplateParams['sshKeys'][number] | undefined {
  return keys.find((key) => matchesKeyPath(scriptPath, key))
}

function orderProjects(projects: ProjectDirectory[]): ProjectDirectory[] {
  return [...projects].sort((a, b) => b.path.trim().length - a.path.trim().length)
}

function applyReplacements(script: string, replacements: ScriptToTemplateReplacement[]): string {
  const unique = new Map<string, ScriptToTemplateReplacement>()
  for (const item of replacements) {
    if (!item.from || item.from.includes('{{')) continue
    if (!unique.has(item.from) || item.from.length > unique.get(item.from)!.from.length) {
      unique.set(item.from, item)
    }
  }
  const sorted = [...unique.values()].sort((a, b) => b.from.length - a.from.length)
  let result = script
  for (const item of sorted) {
    result = result.split(item.from).join(item.to)
  }
  return result
}

function addProjectPathReplacements(
  script: string,
  project: ProjectDirectory,
  replacements: ScriptToTemplateReplacement[]
): void {
  const path = project.path.trim()
  const name = project.name.trim()
  if (!path || !name) return
  const token = slotToken(name)
  if (script.includes(path)) {
    replacements.push({ from: path, to: token, slot: name })
  }

  let index = 0
  const prefix = `${path}/`
  while ((index = script.indexOf(prefix, index)) !== -1) {
    let end = index + prefix.length
    while (end < script.length && !/[\s"'`,)]/.test(script[end])) end += 1
    const full = script.slice(index, end)
    const suffix = full.slice(path.length)
    if (suffix && !full.includes('{{')) {
      replacements.push({ from: full, to: `${token}${suffix.replace(/^\//, '')}`, slot: name })
    }
    index += prefix.length
  }

  const base = basename(path)
  if (base && script.includes(`cd ${base}`)) {
    replacements.push({ from: `cd ${base}`, to: `cd ${token}`, slot: name })
  }

  if (base) {
    const pathByBase = new RegExp(`((?:\\/Users|\\/home)\\/[^\\s"'\\\`,)]*\\/${escapeRegExp(base)})(\\/[\\w./-]+)?`, 'g')
    let match: RegExpExecArray | null
    while ((match = pathByBase.exec(script)) !== null) {
      const full = match[0]
      const suffix = match[2] || ''
      replacements.push({ from: full, to: `${token}${suffix.replace(/^\//, '')}`, slot: name })
    }
  }
}

export function convertScriptToTemplate(params: ScriptToTemplateParams): ScriptToTemplateResult {
  const script = params.script
  if (!script.trim()) {
    return { content: script, replacements: [] }
  }

  const replacements: ScriptToTemplateReplacement[] = []
  const projects = orderProjects(params.projectDirectories)

  let matchedProjectId: string | undefined
  let sshKeyRef: string | undefined

  for (const project of projects) {
    if (!project.path.trim() || !project.name.trim()) continue
    if (!script.includes(project.path.trim())) continue
    addProjectPathReplacements(script, project, replacements)
    if (!matchedProjectId) matchedProjectId = project.id
  }

  for (const project of projects) {
    const path = project.path.trim()
    const name = project.name.trim()
    if (!path || !name) continue
    const base = basename(path)
    const token = slotToken(name)
    if (base && script.includes(`cd ${base}`)) {
      replacements.push({ from: `cd ${base}`, to: `cd ${token}`, slot: name })
      if (!matchedProjectId) matchedProjectId = project.id
    }
    if (script.includes(`cd ${name}`)) {
      replacements.push({ from: `cd ${name}`, to: `cd ${token}`, slot: name })
      if (!matchedProjectId) matchedProjectId = project.id
    }
  }

  const relativeMatch = addRelativeProjectNameReplacements(script, projects, replacements)
  if (!matchedProjectId && relativeMatch) matchedProjectId = relativeMatch

  sshKeyRef = addSshKeyReplacements(script, params.sshKeys, replacements)

  const content = applyReplacements(script, replacements)

  return {
    content,
    sshKeyRef,
    matchedProjectId,
    replacements: [...new Map(replacements.map((item) => [item.from, item])).values()].map(({ from, slot }) => ({
      from,
      slot
    }))
  }
}
