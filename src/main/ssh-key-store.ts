import { app } from 'electron'
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SshKeyConfig } from '../shared/types'

const HOME_DIR = process.env.SHELL_MANAGE_HOME || app.getPath('home')
const KEYS_DIR = join(HOME_DIR, '.shell-manage', 'keys')

export function getSshKeysDir(): string {
  return KEYS_DIR
}

export function getSshKeyFilePath(id: string): string {
  return join(KEYS_DIR, `${sanitizeKeyId(id)}.pem`)
}

export function sanitizeKeyId(id: string): string {
  const normalized = id.trim().replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  if (!normalized) throw new Error('密钥 ID 无效')
  return normalized.slice(0, 64)
}

export function slugifyKeyLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || `key-${Date.now()}`
}

export function validatePrivateKeyContent(content: string): void {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('密钥内容不能为空')
  if (!/BEGIN\s+(?:OPENSSH|RSA|EC|DSA)?\s*PRIVATE KEY/i.test(trimmed)) {
    throw new Error('内容不是有效的 SSH 私钥（需包含 BEGIN ... PRIVATE KEY）')
  }
  if (!/END\s+(?:OPENSSH|RSA|EC|DSA)?\s*PRIVATE KEY/i.test(trimmed)) {
    throw new Error('密钥内容不完整（缺少 END ... PRIVATE KEY）')
  }
}

export function writeSshKeyFile(id: string, content: string): string {
  validatePrivateKeyContent(content)
  mkdirSync(KEYS_DIR, { recursive: true })
  const filePath = getSshKeyFilePath(id)
  const normalized = `${content.trim()}\n`
  writeFileSync(filePath, normalized, { encoding: 'utf-8', mode: 0o600 })
  try {
    chmodSync(filePath, 0o600)
  } catch {
    // Best effort on platforms that ignore chmod.
  }
  return filePath
}

export function deleteSshKeyFile(id: string): void {
  const filePath = getSshKeyFilePath(id)
  if (existsSync(filePath)) unlinkSync(filePath)
}

export function upsertSshKeyMetadata(keys: SshKeyConfig[] | undefined, entry: SshKeyConfig): SshKeyConfig[] {
  const list = Array.isArray(keys) ? [...keys] : []
  const index = list.findIndex((item) => item.id === entry.id)
  if (index >= 0) list[index] = entry
  else list.push(entry)
  return list
}

export function removeSshKeyMetadata(keys: SshKeyConfig[] | undefined, id: string): SshKeyConfig[] {
  if (!Array.isArray(keys)) return []
  return keys.filter((item) => item.id !== id)
}
