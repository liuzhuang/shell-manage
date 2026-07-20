import yaml from 'js-yaml'
import type { AppConfig } from '../../shared/types'

export const CONFIG_YAML_DUMP_OPTIONS = { indent: 2, lineWidth: -1, noRefs: true } as const

export function dumpConfigYaml(doc: unknown): string {
  return yaml.dump(doc, CONFIG_YAML_DUMP_OPTIONS)
}

export function parseConfigYaml(text: string): unknown {
  return yaml.load(text)
}

export async function readAppConfig(): Promise<AppConfig> {
  const raw = await window.api.configRead()
  const parsed = yaml.load(raw) as AppConfig
  if (!parsed || !Array.isArray(parsed.commands) || !Array.isArray(parsed.presets) || !parsed.settings) {
    throw new Error('当前配置结构异常')
  }
  return parsed
}

export async function saveAppConfig(config: AppConfig): Promise<void> {
  await window.api.configSave(dumpConfigYaml(config))
}

export function slugFromPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || 'project'
}

export function createProjectId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'project'}-${Date.now()}`
}
