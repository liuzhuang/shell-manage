import type { AppConfig, DetectedProject, ProjectDirectory } from '../../shared/types'
import { createProjectId } from './config-write'

export async function appendProjectsFromImportSelection(
  config: AppConfig,
  selectedProjects: DetectedProject[]
): Promise<{ added: number; skipped: number }> {
  const existingPaths = new Set((config.projectDirectories || []).map((item) => item.path))
  const merged = [...(config.projectDirectories || [])]
  let added = 0
  let skipped = 0
  for (const project of selectedProjects) {
    if (existingPaths.has(project.rootPath)) {
      skipped += 1
      continue
    }
    const entry: ProjectDirectory = {
      id: createProjectId(project.name),
      name: project.name,
      path: project.rootPath,
      createdAt: new Date().toISOString()
    }
    merged.push(entry)
    existingPaths.add(project.rootPath)
    added += 1
  }
  config.projectDirectories = merged
  return { added, skipped }
}

export async function appendProjectSubdirectories(
  config: AppConfig,
  rootPath: string,
  selectedItems: Array<{ name: string; path: string }>
): Promise<{ added: number; skipped: number }> {
  const existingPaths = new Set((config.projectDirectories || []).map((item) => item.path))
  const merged = [...(config.projectDirectories || [])]
  let added = 0
  let skipped = 0

  for (const item of selectedItems) {
    if (existingPaths.has(item.path)) {
      skipped += 1
      continue
    }
    const entry: ProjectDirectory = {
      id: createProjectId(item.name),
      name: item.name,
      path: item.path,
      createdAt: new Date().toISOString()
    }
    merged.push(entry)
    existingPaths.add(item.path)
    added += 1
  }

  config.projectDirectories = merged
  return { added, skipped }
}
