import type {
  AppConfig,
  CollaborationExportDraft,
  CollaborationImportDraft,
  CollaborationImportProjectRow,
  CollaborationImportScriptRow,
  CollaborationMergeResult,
  CollaborationSharePayload,
  CollaborationShareProjectEntry,
  CollaborationShareScriptEntry,
  DeployScriptConfig,
  ProjectDirectory
} from '../../shared/types'
import { createProjectId, dumpConfigYaml, parseConfigYaml } from './config-write'

const TEMPLATE_SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g
const COLLABORATION_SHARE_HEADER =
  '# Shell管理 协作分享（与 config.yaml 中 projectDirectories / deployScripts 格式一致，不含本机 path）\n'

/** @deprecated 旧版 JSON 协作包，导入时仍兼容 */
const LEGACY_BUNDLE_KIND = 'shell-manage.collaboration'

export type CollaborationShareParseErrorCode =
  | 'EMPTY'
  | 'INVALID_YAML'
  | 'INVALID_SHAPE'
  | 'UNSUPPORTED_VERSION'

export type CollaborationShareParseResult =
  | { ok: true; share: CollaborationSharePayload }
  | { ok: false; errorCode: CollaborationShareParseErrorCode; message: string }

function normalizeSlotName(raw: string): string {
  return raw.trim()
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

export function collectProjectNamesFromShare(share: CollaborationSharePayload): string[] {
  const nameSet = new Set<string>()
  for (const project of share.projectDirectories || []) {
    const name = project.name.trim()
    if (name) nameSet.add(name)
  }
  for (const script of share.deployScripts || []) {
    for (const slot of collectTemplateSlots(script.content)) {
      nameSet.add(slot)
    }
  }
  return [...nameSet].sort((a, b) => a.localeCompare(b, 'zh-CN'))
}

function normalizeShareProjects(raw: unknown): CollaborationShareProjectEntry[] {
  if (!Array.isArray(raw)) return []
  const result: CollaborationShareProjectEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (name) result.push({ name })
  }
  return result
}

function normalizeShareScripts(raw: unknown): CollaborationShareScriptEntry[] {
  if (!Array.isArray(raw)) return []
  const scripts: CollaborationShareScriptEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    const content = typeof row.content === 'string' ? row.content : ''
    if (!name && !content.trim()) continue
    scripts.push({ name: name || '未命名脚本', content })
  }
  return scripts
}

function legacyRecordToShare(record: Record<string, unknown>): CollaborationSharePayload | null {
  if (record.kind !== LEGACY_BUNDLE_KIND) return null
  if (record.version !== 1) {
    return null
  }

  const projectNames = Array.isArray(record.projectNames)
    ? record.projectNames.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  const deployScripts: CollaborationShareScriptEntry[] = []
  if (Array.isArray(record.scripts)) {
    for (const item of record.scripts) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const name = typeof row.name === 'string' ? row.name.trim() : ''
      const content = typeof row.content === 'string' ? row.content : ''
      if (!name && !content.trim()) continue
      deployScripts.push({ name: name || '未命名脚本', content })
    }
  }

  const nameSet = new Set(projectNames)
  for (const script of deployScripts) {
    for (const slot of collectTemplateSlots(script.content)) {
      nameSet.add(slot)
    }
  }

  return {
    projectDirectories: [...nameSet].sort((a, b) => a.localeCompare(b, 'zh-CN')).map((name) => ({ name })),
    deployScripts: deployScripts.length > 0 ? deployScripts : undefined
  }
}

function isSharePayloadEmpty(share: CollaborationSharePayload): boolean {
  const projects = share.projectDirectories || []
  const scripts = share.deployScripts || []
  return projects.length === 0 && scripts.length === 0
}

export function buildCollaborationExportDraft(params: {
  projectDirectories: ProjectDirectory[]
  deployScripts: DeployScriptConfig[]
}): CollaborationExportDraft {
  return {
    projects: params.projectDirectories.map((project) => ({
      id: project.id,
      name: project.name.trim() || '未命名项目',
      selected: true
    })),
    scripts: params.deployScripts.map((script) => ({
      id: script.id,
      name: script.name.trim() || '未命名脚本',
      content: script.content,
      selected: true
    }))
  }
}

export function validateCollaborationExportDraft(
  draft: CollaborationExportDraft
): { ok: true } | { ok: false; message: string } {
  const hasProject = draft.projects.some((row) => row.selected)
  const hasScript = draft.scripts.some((row) => row.selected)
  if (!hasProject && !hasScript) {
    return { ok: false, message: '请至少勾选一项再分享' }
  }
  return { ok: true }
}

export function buildCollaborationShareFromExportDraft(draft: CollaborationExportDraft): CollaborationSharePayload {
  const nameSet = new Set<string>()
  const projectDirectories: CollaborationShareProjectEntry[] = []

  for (const row of draft.projects) {
    if (!row.selected) continue
    const name = row.name.trim()
    if (!name) continue
    nameSet.add(name)
    projectDirectories.push({ name })
  }

  const deployScripts: CollaborationShareScriptEntry[] = []
  for (const row of draft.scripts) {
    if (!row.selected) continue
    const name = row.name.trim() || '未命名脚本'
    const content = row.content
    if (!name && !content.trim()) continue
    deployScripts.push({ name, content })
    for (const slot of collectTemplateSlots(content)) {
      nameSet.add(slot)
    }
  }

  for (const name of nameSet) {
    if (!projectDirectories.some((item) => item.name === name)) {
      projectDirectories.push({ name })
    }
  }

  projectDirectories.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  const share: CollaborationSharePayload = {}
  if (projectDirectories.length > 0) share.projectDirectories = projectDirectories
  if (deployScripts.length > 0) share.deployScripts = deployScripts
  return share
}

export function serializeCollaborationShare(share: CollaborationSharePayload): string {
  return COLLABORATION_SHARE_HEADER + dumpConfigYaml(share).trimEnd() + '\n'
}

export function parseCollaborationShare(text: string): CollaborationShareParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: false, errorCode: 'EMPTY', message: '剪贴板里没有协作包，请先让同事复制后再试' }
  }

  let parsed: unknown
  try {
    parsed = parseConfigYaml(trimmed)
  } catch {
    return { ok: false, errorCode: 'INVALID_YAML', message: '剪贴板内容不是有效的 YAML 配置片段' }
  }

  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, errorCode: 'INVALID_SHAPE', message: '协作包格式不正确，需要 projectDirectories 或 deployScripts' }
  }

  const record = parsed as Record<string, unknown>

  const legacy = legacyRecordToShare(record)
  if (legacy) {
    if (isSharePayloadEmpty(legacy)) {
      return { ok: false, errorCode: 'INVALID_SHAPE', message: '协作包为空，没有可导入的项目或脚本' }
    }
    return { ok: true, share: legacy }
  }

  if (record.kind === LEGACY_BUNDLE_KIND) {
    return { ok: false, errorCode: 'UNSUPPORTED_VERSION', message: '协作包版本过新，请升级应用后再导入' }
  }

  const share: CollaborationSharePayload = {
    projectDirectories: normalizeShareProjects(record.projectDirectories),
    deployScripts: normalizeShareScripts(record.deployScripts)
  }

  if (isSharePayloadEmpty(share)) {
    return { ok: false, errorCode: 'INVALID_SHAPE', message: '协作包为空，没有可导入的项目或脚本' }
  }

  return { ok: true, share }
}

export function buildCollaborationImportDraft(
  config: AppConfig,
  share: CollaborationSharePayload
): CollaborationImportDraft {
  const directories = config.projectDirectories || []
  const deployScripts = config.deployScripts || []
  const byName = new Map<string, ProjectDirectory>()
  for (const project of directories) {
    const name = project.name.trim()
    if (name && !byName.has(name)) byName.set(name, project)
  }

  const projects: CollaborationImportProjectRow[] = collectProjectNamesFromShare(share).map((name) => {
    const existing = byName.get(name)
    return {
      name,
      selected: true,
      path: undefined,
      existingPath: existing?.path
    }
  })

  const scripts: CollaborationImportScriptRow[] = (share.deployScripts || []).map((script) => {
    const name = script.name.trim() || '未命名脚本'
    const hasConflict = deployScripts.some((item) => item.name.trim() === name)
    return {
      name,
      content: script.content,
      selected: true,
      hasConflict,
      conflictAction: 'skip'
    }
  })

  return { share, projects, scripts }
}

export function projectRowNeedsPath(row: CollaborationImportProjectRow): boolean {
  if (!row.selected) return false
  if (row.existingPath) return false
  return !row.path?.trim()
}

export function resolveAvailableProjectNamesAfterImport(
  existingDirectories: ProjectDirectory[],
  projects: CollaborationImportProjectRow[]
): Set<string> {
  const names = new Set<string>()
  for (const project of existingDirectories) {
    const name = project.name.trim()
    if (name) names.add(name)
  }
  for (const row of projects) {
    if (!row.selected) continue
    const path = row.existingPath || row.path?.trim()
    if (path) names.add(row.name)
  }
  return names
}

export function missingProjectSlotsForScript(content: string, availableNames: Set<string>): string[] {
  const missing: string[] = []
  for (const slot of collectTemplateSlots(content)) {
    if (!availableNames.has(slot)) missing.push(slot)
  }
  return missing
}

export function validateCollaborationImportDraft(
  config: AppConfig,
  draft: CollaborationImportDraft
): { ok: true } | { ok: false; message: string } {
  const selectedProjects = draft.projects.filter((row) => row.selected)
  const selectedScripts = draft.scripts.filter((row) => row.selected)

  if (selectedProjects.length === 0 && selectedScripts.length === 0) {
    return { ok: false, message: '请至少勾选一项再导入' }
  }

  const needsPath = selectedProjects.filter((row) => projectRowNeedsPath(row))
  if (needsPath.length > 0) {
    return {
      ok: false,
      message: `请为每个项目名选择本机文件夹：${needsPath.map((row) => row.name).join('、')}`
    }
  }

  const availableNames = resolveAvailableProjectNamesAfterImport(
    config.projectDirectories || [],
    draft.projects
  )
  for (const script of selectedScripts) {
    const missing = missingProjectSlotsForScript(script.content, availableNames)
    if (missing.length > 0) {
      return {
        ok: false,
        message: `脚本「${script.name}」引用了未绑定的项目名：${missing.map((item) => `{{${item}}}`).join('、')}`
      }
    }
  }

  return { ok: true }
}

function createDeployScriptId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `deploy-${slug || 'script'}-${Date.now()}`
}

export function mergeCollaborationImportIntoConfig(
  config: AppConfig,
  draft: CollaborationImportDraft
): CollaborationMergeResult {
  const result: CollaborationMergeResult = {
    projectsAdded: 0,
    projectsSkipped: 0,
    scriptsAdded: 0,
    scriptsOverwritten: 0,
    scriptsSkipped: 0
  }

  const directories = [...(config.projectDirectories || [])]
  const byName = new Map<string, ProjectDirectory>()
  for (const project of directories) {
    const name = project.name.trim()
    if (name) byName.set(name, project)
  }

  for (const row of draft.projects) {
    if (!row.selected) continue
    const name = row.name.trim()
    if (!name) continue

    const existing = byName.get(name)
    const path = (row.existingPath || row.path || '').trim()
    if (!path) continue

    if (existing) {
      result.projectsSkipped += 1
      continue
    }

    const entry: ProjectDirectory = {
      id: createProjectId(name),
      name,
      path,
      createdAt: new Date().toISOString()
    }
    directories.push(entry)
    byName.set(name, entry)
    result.projectsAdded += 1
  }

  const scripts = [...(config.deployScripts || [])]

  for (const row of draft.scripts) {
    if (!row.selected) continue
    const name = row.name.trim() || '未命名脚本'
    const content = row.content
    const index = scripts.findIndex((item) => item.name.trim() === name)

    if (index >= 0) {
      if (row.conflictAction === 'overwrite') {
        const prev = scripts[index]
        scripts[index] = {
          ...prev,
          name,
          content,
          sshKeyRef: undefined
        }
        result.scriptsOverwritten += 1
      } else {
        result.scriptsSkipped += 1
      }
      continue
    }

    scripts.push({
      id: createDeployScriptId(name),
      name,
      content,
      createdAt: new Date().toISOString()
    })
    result.scriptsAdded += 1
  }

  config.projectDirectories = directories
  config.deployScripts = scripts

  return result
}

export function formatCollaborationMergeSummary(result: CollaborationMergeResult): string {
  const parts: string[] = []
  if (result.projectsAdded > 0) parts.push(`新增 ${result.projectsAdded} 个项目目录`)
  if (result.projectsSkipped > 0) parts.push(`跳过 ${result.projectsSkipped} 个项目目录`)
  if (result.scriptsAdded > 0) parts.push(`新增 ${result.scriptsAdded} 个脚本`)
  if (result.scriptsOverwritten > 0) parts.push(`覆盖 ${result.scriptsOverwritten} 个脚本`)
  if (result.scriptsSkipped > 0) parts.push(`跳过 ${result.scriptsSkipped} 个脚本`)
  return parts.length > 0 ? parts.join('，') : '没有导入新内容'
}

/** @deprecated 使用 buildCollaborationShareFromExportDraft */
export function buildCollaborationBundleFromExportDraft(draft: CollaborationExportDraft) {
  return buildCollaborationShareFromExportDraft(draft)
}

/** @deprecated 使用 serializeCollaborationShare */
export function serializeCollaborationBundle(share: CollaborationSharePayload): string {
  return serializeCollaborationShare(share)
}

/** @deprecated 使用 parseCollaborationShare */
export function parseCollaborationBundle(text: string): CollaborationShareParseResult {
  return parseCollaborationShare(text)
}
