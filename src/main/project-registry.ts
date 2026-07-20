import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProjectDirectory, ProjectDirectoryStatus, ProjectDirectoryValidation, ProjectSubdirectoryItem } from '../shared/types'

export function validateProjectPath(path: string): ProjectDirectoryStatus {
  const trimmed = path.trim()
  if (!trimmed) return 'missing'
  if (!existsSync(trimmed)) return 'missing'
  try {
    const stat = statSync(trimmed)
    if (!stat.isDirectory()) return 'missing'
    accessSync(trimmed, constants.R_OK)
    return 'ok'
  } catch {
    return 'permission_denied'
  }
}

export function validateProjectDirectories(directories: ProjectDirectory[]): ProjectDirectoryValidation[] {
  return directories.map((item) => ({
    id: item.id,
    name: item.name,
    path: item.path,
    status: validateProjectPath(item.path)
  }))
}

export async function listImmediateSubdirectories(rootPath: string): Promise<ProjectSubdirectoryItem[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      path: join(rootPath, entry.name)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function projectDirectoryStatusLabel(status: ProjectDirectoryStatus): string {
  switch (status) {
    case 'ok':
      return '目录可用'
    case 'missing':
      return '目录不存在'
    case 'permission_denied':
      return '权限不足'
  }
}
