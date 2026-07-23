import type { CookiesSetDetails, Session } from 'electron'
import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { buildChildProcessEnvironment } from './child-process-env'
import type {
  BrowserProfileImportResult,
  BrowserProfileListResult,
  BrowserProfileSummary
} from '../shared/browser-types'

type CookieStoreKind = 'chromium' | 'firefox'

interface BrowserDefinition {
  source: string
  appName: string
  rootPath: string
  kind: CookieStoreKind
  directProfile?: boolean
  keychainServices?: string[]
}

interface ImportableBrowserProfile extends BrowserProfileSummary {
  profilePath: string
  cookiePath: string
  kind: CookieStoreKind
  keychainServices: string[]
}

interface CookieRow {
  host: string
  name: string
  value: string
  encryptedValue: Buffer
  path: string
  expires: number
  secure: number
  httpOnly: number
  sameSite: number
  partitionKey: string
  databaseVersion: number
  kind: CookieStoreKind
}

interface SqliteDatabase {
  pragma: (source: string) => unknown
  prepare: (source: string) => { all: () => unknown[] }
  close: () => void
}

type SqliteConstructor = new (
  path: string,
  options: { readonly: boolean; fileMustExist: boolean }
) => SqliteDatabase

const CHROME_EPOCH_SECONDS = 11_644_473_600
const COOKIE_IMPORT_BATCH_SIZE = 100
const SQLITE_SIDECARS = ['-wal', '-shm', '-journal']

export class BrowserProfileImporter {
  async list(): Promise<BrowserProfileListResult> {
    if (process.platform !== 'darwin') {
      return { supported: false, profiles: [], error: '当前版本仅支持在 macOS 导入浏览器 Profile。' }
    }

    const { profiles, failedSources } = await discoverProfiles()
    return {
      supported: true,
      profiles: profiles.map(({ id, source, appName, profileName }) => ({ id, source, appName, profileName })),
      error: failedSources > 0 ? '部分浏览器 Profile 无法读取。' : undefined
    }
  }

  async import(profileId: string, targetSession: Session): Promise<BrowserProfileImportResult> {
    const base = { profileId, imported: 0, skipped: 0, failed: 0 }
    if (process.platform !== 'darwin') {
      return { ...base, ok: false, error: '当前版本仅支持在 macOS 导入浏览器 Profile。' }
    }

    const { profiles } = await discoverProfiles()
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return { ...base, ok: false, error: '该浏览器 Profile 已不存在或不可读取。' }

    try {
      const rows = await withDatabaseSnapshot(profile.cookiePath, (snapshotPath) => readCookieRows(snapshotPath, profile.kind))
      const hasEncryptedCookies = rows.some((row) => row.encryptedValue.length > 0 && !row.value)
      const key = hasEncryptedCookies ? await readMacCookieKey(profile.keychainServices) : null
      const cookies: CookiesSetDetails[] = []
      let skipped = 0
      let failed = 0

      for (const row of rows) {
        if (row.partitionKey) {
          skipped += 1
          continue
        }

        let value = row.value
        if (row.encryptedValue.length > 0) {
          if (row.value) {
            failed += 1
            continue
          }
          if (!key) {
            failed += 1
            continue
          }
          try {
            value = decryptChromiumCookie(row.encryptedValue, key, row.host, row.databaseVersion)
          } catch {
            failed += 1
            continue
          }
        }

        const cookie = toElectronCookie(row, value)
        if (!cookie) skipped += 1
        else cookies.push(cookie)
      }

      let imported = 0
      for (let index = 0; index < cookies.length; index += COOKIE_IMPORT_BATCH_SIZE) {
        const results = await Promise.allSettled(
          cookies.slice(index, index + COOKIE_IMPORT_BATCH_SIZE).map((cookie) => targetSession.cookies.set(cookie))
        )
        imported += results.filter((result) => result.status === 'fulfilled').length
        failed += results.filter((result) => result.status === 'rejected').length
      }
      await targetSession.cookies.flushStore()

      return {
        ok: failed === 0,
        profileId,
        appName: profile.appName,
        profileName: profile.profileName,
        imported,
        skipped,
        failed,
        error:
          failed > 0
            ? imported > 0
              ? '部分 Cookie 无法解密或写入。'
              : '无法解密或写入 Cookie；请彻底退出源浏览器并允许 ShellManage 访问钥匙串。'
            : undefined
      }
    } catch (error) {
      return {
        ...base,
        ok: false,
        appName: profile.appName,
        profileName: profile.profileName,
        error: error instanceof Error ? error.message : '浏览器 Profile 导入失败。'
      }
    }
  }
}

async function discoverProfiles(): Promise<{ profiles: ImportableBrowserProfile[]; failedSources: number }> {
  const settled = await Promise.allSettled(browserDefinitions().map(discoverDefinitionProfiles))
  const profiles = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  profiles.sort((left, right) =>
    `${left.appName}\0${left.profileName}`.localeCompare(`${right.appName}\0${right.profileName}`, 'zh-CN')
  )
  return { profiles, failedSources: settled.filter((result) => result.status === 'rejected').length }
}

async function discoverDefinitionProfiles(definition: BrowserDefinition): Promise<ImportableBrowserProfile[]> {
  const rootStat = await safeLstat(definition.rootPath)
  if (!rootStat?.isDirectory()) return []

  const names = definition.kind === 'chromium' ? await readChromiumProfileNames(definition.rootPath) : {}
  const profilePaths = definition.directProfile
    ? [definition.rootPath]
    : (await readdir(definition.rootPath, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(definition.rootPath, entry.name))

  const profiles: ImportableBrowserProfile[] = []
  for (const profilePath of profilePaths) {
    const cookiePath = await findCookieDatabase(profilePath, definition.kind)
    if (!cookiePath) continue
    const directoryName = basename(profilePath)
    profiles.push({
      id: createHash('sha256').update(`${definition.source}\0${profilePath}`).digest('hex').slice(0, 24),
      source: definition.source,
      appName: definition.appName,
      profileName: names[directoryName] || (directoryName === 'Default' ? '默认 Profile' : directoryName),
      profilePath,
      cookiePath,
      kind: definition.kind,
      keychainServices: definition.keychainServices || []
    })
  }
  return profiles
}

function browserDefinitions(): BrowserDefinition[] {
  const home = process.env.SHELL_MANAGE_HOME?.trim() || homedir()
  const support = join(home, 'Library', 'Application Support')
  return [
    chromium('chrome', 'Chrome', join(support, 'Google', 'Chrome'), 'Chrome Safe Storage'),
    chromium('chrome-canary', 'Chrome Canary', join(support, 'Google', 'Chrome Canary'), 'Chromium Safe Storage'),
    chromium('chrome-testing', 'Chrome for Testing', join(support, 'Google', 'Chrome for Testing'), 'Chromium Safe Storage'),
    chromium('edge', 'Microsoft Edge', join(support, 'Microsoft Edge'), 'Microsoft Edge Safe Storage'),
    chromium('brave', 'Brave', join(support, 'BraveSoftware', 'Brave-Browser'), 'Brave Browser Safe Storage'),
    chromium('arc', 'Arc', join(support, 'Arc', 'User Data'), 'Arc Safe Storage'),
    chromium('chromium', 'Chromium', join(support, 'Chromium'), 'Chromium Safe Storage'),
    chromium('vivaldi', 'Vivaldi', join(support, 'Vivaldi'), 'Vivaldi Safe Storage'),
    chromium('opera', 'Opera', join(support, 'com.operasoftware.Opera'), 'Opera Safe Storage', true),
    chromium('opera-gx', 'Opera GX', join(support, 'com.operasoftware.OperaGX'), 'Opera Safe Storage', true),
    chromium('atlas', 'Atlas', join(support, 'com.openai.atlas', 'browser-data'), 'ChatGPT Safe Storage'),
    { source: 'firefox', appName: 'Firefox', rootPath: join(support, 'Firefox', 'Profiles'), kind: 'firefox' }
  ]
}

function chromium(
  source: string,
  appName: string,
  rootPath: string,
  keychainService: string | string[],
  directProfile = false
): BrowserDefinition {
  return {
    source,
    appName,
    rootPath,
    kind: 'chromium',
    directProfile,
    keychainServices: Array.isArray(keychainService) ? keychainService : [keychainService]
  }
}

async function readChromiumProfileNames(rootPath: string): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(join(rootPath, 'Local State'), 'utf-8')) as {
      profile?: { info_cache?: Record<string, { name?: unknown }> }
    }
    return Object.fromEntries(
      Object.entries(parsed.profile?.info_cache || {}).flatMap(([directory, value]) =>
        typeof value.name === 'string' && value.name.trim() ? [[directory, value.name.trim()]] : []
      )
    )
  } catch {
    return {}
  }
}

async function findCookieDatabase(profilePath: string, kind: CookieStoreKind): Promise<string | null> {
  const candidates = kind === 'firefox'
    ? [join(profilePath, 'cookies.sqlite')]
    : [join(profilePath, 'Network', 'Cookies'), join(profilePath, 'Cookies')]
  for (const candidate of candidates) {
    const fileStat = await safeLstat(candidate)
    if (fileStat?.isFile() && !fileStat.isSymbolicLink()) return candidate
  }
  return null
}

async function safeLstat(path: string) {
  try {
    return await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function withDatabaseSnapshot<T>(sourcePath: string, read: (snapshotPath: string) => T): Promise<T> {
  const sourceStat = await lstat(sourcePath)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Cookie 数据库不可读取。')
  const directory = await mkdtemp(join(tmpdir(), 'shell-manage-browser-profile-'))
  const snapshotPath = join(directory, basename(sourcePath))
  try {
    await copyFile(sourcePath, snapshotPath)
    for (const suffix of SQLITE_SIDECARS) {
      const sidecarPath = `${sourcePath}${suffix}`
      const sidecarStat = await safeLstat(sidecarPath)
      if (!sidecarStat) continue
      if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink()) throw new Error('Cookie 数据库附属文件不可读取。')
      await copyFile(sidecarPath, `${snapshotPath}${suffix}`)
    }
    return read(snapshotPath)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function readCookieRows(databasePath: string, kind: CookieStoreKind): CookieRow[] {
  const Database = require('better-sqlite3') as SqliteConstructor
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('query_only = ON')
    const databaseVersion = kind === 'chromium' ? readChromiumDatabaseVersion(database) : 0
    const table = kind === 'chromium' ? 'cookies' : 'moz_cookies'
    const columns = new Set(
      (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>).flatMap((row) =>
        typeof row.name === 'string' ? [row.name] : []
      )
    )
    const required = kind === 'chromium'
      ? ['host_key', 'name', 'value', 'encrypted_value', 'path', 'expires_utc', 'is_secure', 'is_httponly']
      : ['host', 'name', 'value', 'path', 'expiry', 'isSecure', 'isHttpOnly']
    if (required.some((column) => !columns.has(column))) throw new Error('Cookie 数据库格式不受支持。')

    const pick = (column: string, alias: string, fallback: string) =>
      columns.has(column) ? `"${column}" AS "${alias}"` : `${fallback} AS "${alias}"`
    const select = kind === 'chromium'
      ? [
          pick('host_key', 'host', "''"),
          pick('name', 'name', "''"),
          pick('value', 'value', "''"),
          pick('encrypted_value', 'encryptedValue', "X''"),
          pick('path', 'path', "'/'"),
          pick('expires_utc', 'expires', '0'),
          pick('is_secure', 'secure', '0'),
          pick('is_httponly', 'httpOnly', '0'),
          pick('samesite', 'sameSite', '-1'),
          pick('top_frame_site_key', 'partitionKey', "''")
        ]
      : [
          pick('host', 'host', "''"),
          pick('name', 'name', "''"),
          pick('value', 'value', "''"),
          "X'' AS \"encryptedValue\"",
          pick('path', 'path', "'/'"),
          pick('expiry', 'expires', '0'),
          pick('isSecure', 'secure', '0'),
          pick('isHttpOnly', 'httpOnly', '0'),
          pick('sameSite', 'sameSite', '-1'),
          pick('originAttributes', 'partitionKey', "''")
        ]
    return (database.prepare(`SELECT ${select.join(', ')} FROM ${table}`).all() as Array<Record<string, unknown>>).map((row) => ({
      host: String(row.host || ''),
      name: String(row.name || ''),
      value: String(row.value || ''),
      encryptedValue: Buffer.isBuffer(row.encryptedValue) ? row.encryptedValue : Buffer.from([]),
      path: String(row.path || '/'),
      expires: Number(row.expires || 0),
      secure: Number(row.secure || 0),
      httpOnly: Number(row.httpOnly || 0),
      sameSite: Number(row.sameSite ?? -1),
      partitionKey: String(row.partitionKey || ''),
      databaseVersion,
      kind
    }))
  } finally {
    database.close()
  }
}

function readChromiumDatabaseVersion(database: SqliteDatabase): number {
  const [row] = database.prepare("SELECT value FROM meta WHERE key = 'version'").all() as Array<{ value?: unknown }>
  const version = Number(row?.value)
  if (!Number.isInteger(version) || version < 0) throw new Error('Cookie 数据库格式不受支持。')
  return version
}

async function readMacCookieKey(services: string[]): Promise<Buffer | null> {
  for (const service of services) {
    const password = await new Promise<string | null>((resolve) => {
      execFile('/usr/bin/security', ['find-generic-password', '-w', '-s', service], {
        env: buildChildProcessEnvironment()
      }, (error, stdout) => {
        resolve(error ? null : String(stdout).trimEnd())
      })
    })
    if (password) return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  }
  return null
}

export function decryptChromiumCookie(
  encryptedValue: Buffer,
  key: Buffer,
  host: string,
  databaseVersion: number
): string {
  const prefix = encryptedValue.subarray(0, 3).toString('ascii')
  if (prefix !== 'v10' && prefix !== 'v11') throw new Error('unsupported cookie encryption')
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  let decrypted = Buffer.concat([decipher.update(encryptedValue.subarray(3)), decipher.final()])
  if (databaseVersion >= 24) {
    const hostDigest = createHash('sha256').update(host).digest()
    if (decrypted.length < hostDigest.length || !decrypted.subarray(0, hostDigest.length).equals(hostDigest)) {
      throw new Error('cookie host integrity check failed')
    }
    decrypted = decrypted.subarray(hostDigest.length)
  }
  return decrypted.toString('utf-8')
}

function toElectronCookie(row: CookieRow, value: string): CookiesSetDetails | null {
  const domain = row.host.trim()
  const host = domain.startsWith('.') ? domain.slice(1) : domain
  if (!host || /[\s/]/.test(host)) return null
  const urlHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  const secure = row.secure !== 0
  try {
    new URL(`${secure ? 'https' : 'http'}://${urlHost}`)
  } catch {
    return null
  }

  let expirationDate: number | undefined
  if (row.expires > 0) {
    expirationDate = row.kind === 'chromium' ? row.expires / 1_000_000 - CHROME_EPOCH_SECONDS : row.expires
    if (!Number.isFinite(expirationDate) || expirationDate <= Date.now() / 1000) return null
  }

  return {
    url: `${secure ? 'https' : 'http'}://${urlHost}`,
    name: row.name,
    value,
    ...(domain.startsWith('.') ? { domain } : {}),
    path: row.path.startsWith('/') ? row.path : '/',
    secure,
    httpOnly: row.httpOnly !== 0,
    ...(expirationDate === undefined ? {} : { expirationDate }),
    sameSite: row.sameSite === 0 ? 'no_restriction' : row.sameSite === 1 ? 'lax' : row.sameSite === 2 ? 'strict' : 'unspecified'
  }
}
