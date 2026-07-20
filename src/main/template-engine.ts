import { existsSync } from 'node:fs'
import type { DeployScriptConfig, ProjectDirectory, SshKeyConfig, TemplatePreviewResult } from '../shared/types'
import { getSshKeyFilePath } from './ssh-key-store'

export const DEFAULT_DEPLOY_TEMPLATE = `# 粘贴现有脚本后，点击「替换为插槽」
# 插槽格式：{{项目目录名称}} / {{SSH密钥名称}}
`

export const TEMPLATE_SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g

export function normalizeSlotName(raw: string): string {
  return raw.trim()
}

export function buildKnownSlotNames(projectDirectories: ProjectDirectory[], sshKeys: SshKeyConfig[]): string[] {
  const names = new Set<string>()
  for (const project of projectDirectories) {
    const name = project.name.trim()
    if (name) names.add(name)
  }
  for (const key of sshKeys) {
    const label = key.label.trim()
    if (label) names.add(label)
  }
  return [...names]
}

export function createDefaultDeployScript(id = 'deploy-front'): DeployScriptConfig {
  return {
    id,
    name: '前端部署',
    content: DEFAULT_DEPLOY_TEMPLATE,
    deployTarget: 'root@example.com',
    remoteDir: '/var/www/example-app'
  }
}

export function collectTemplateSlots(template: string): string[] {
  const slots = new Set<string>()
  TEMPLATE_SLOT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TEMPLATE_SLOT_RE.exec(template)) !== null) {
    slots.add(normalizeSlotName(match[1]))
  }
  return [...slots]
}

export function buildSlotValues(params: {
  projectDirectories: ProjectDirectory[]
  sshKeys: SshKeyConfig[]
}): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {}

  for (const project of params.projectDirectories) {
    const name = project.name.trim()
    if (name) values[name] = project.path
  }

  for (const key of params.sshKeys) {
    const label = key.label.trim()
    if (!label) continue
    try {
      const filePath = getSshKeyFilePath(key.id)
      values[label] = existsSync(filePath) ? filePath : undefined
    } catch {
      values[label] = undefined
    }
  }

  return values
}

export function renderTemplate(
  template: string,
  values: Record<string, string | undefined>,
  knownSlots: string[]
): { rendered: string; missingSlots: string[]; unknownSlots: string[] } {
  const known = new Set(knownSlots)
  const missingSlots = new Set<string>()
  const unknownSlots = new Set<string>()
  TEMPLATE_SLOT_RE.lastIndex = 0

  const rendered = template.replace(TEMPLATE_SLOT_RE, (match, rawName: string) => {
    const name = normalizeSlotName(rawName)
    if (!known.has(name)) {
      unknownSlots.add(name)
      return match
    }
    const value = values[name]
    if (value === undefined || value === '') {
      missingSlots.add(name)
      return match
    }
    return value
  })

  return {
    rendered,
    missingSlots: [...missingSlots],
    unknownSlots: [...unknownSlots]
  }
}

export function previewDeployTemplate(params: {
  template: string
  projectDirectories: ProjectDirectory[]
  sshKeys: SshKeyConfig[]
}): TemplatePreviewResult {
  const directories = params.projectDirectories
  const knownSlots = buildKnownSlotNames(directories, params.sshKeys)
  const usedSlots = collectTemplateSlots(params.template)
  const slotValues = buildSlotValues({
    projectDirectories: directories,
    sshKeys: params.sshKeys
  })
  const result = renderTemplate(params.template, slotValues, knownSlots)

  return {
    rendered: result.rendered,
    slotValues,
    missingSlots: result.missingSlots,
    unknownSlots: result.unknownSlots,
    knownSlots,
    usedSlots
  }
}
