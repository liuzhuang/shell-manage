import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const skillRoot = join(repoRoot, 'skills/shell-manage-assistant')
const referencesRoot = join(skillRoot, 'references')
const releasePage = 'https://github.com/liuzhuang/shell-manage/releases'
const latestReleaseApi = 'https://api.github.com/repos/liuzhuang/shell-manage/releases/latest'
const errors = []

function check(condition, message) {
  if (!condition) errors.push(message)
}

function read(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8')
}

function collectTextFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectTextFiles(path)
    return /\.(?:json|md|sh|ya?ml)$/.test(entry.name) ? [path] : []
  })
}

const relatedFiles = [
  ...collectTextFiles(skillRoot),
  join(repoRoot, 'skills/README.md'),
  ...[
    join(repoRoot, 'docs/2026-06-01/skills-e2e.md'),
    join(repoRoot, 'docs/marketing/产品定位.md')
  ].filter(existsSync)
]

const forbiddenText = [
  ['distribution-' + 'manifest.yaml', 'legacy distribution manifest reference'],
  ['REPLACE_WITH_REAL_' + 'SHA256', 'placeholder checksum'],
  ['example.com/' + 'shell-manage', 'placeholder release URL']
]

for (const path of relatedFiles) {
  const content = readFileSync(path, 'utf8')
  for (const [text, label] of forbiddenText) {
    check(!content.includes(text), `${path}: contains ${label}`)
  }
  check(
    !/macOS.{0,80}(?:不启用|不支持|不会).{0,20}自动更新/u.test(content),
    `${path}: contains obsolete macOS automatic-update claim`
  )
}

check(
  !existsSync(join(referencesRoot, 'distribution-' + 'manifest.yaml')),
  'legacy distribution manifest file still exists'
)

const skillText = read('skills/shell-manage-assistant/SKILL.md')
const installText = read('skills/shell-manage-assistant/references/install-and-upgrade.md')
const resolverText = read('skills/shell-manage-assistant/scripts/resolve-knowledge-root.sh')

check(/metadata:\s*\n\s+version:\s*["'][^"']+["']/u.test(skillText), 'SKILL.md metadata.version is missing')
check(installText.includes('GitHub Releases 是 ShellManage 公开版本、安装包和升级信息的唯一事实源'), 'missing single public release source rule')
check(installText.includes(releasePage), 'missing official GitHub Releases page')
check(installText.includes(latestReleaseApi), 'missing latest stable release API')
for (const field of ['draft', 'prerelease', 'assets', 'browser_download_url']) {
  check(installText.includes(`\`${field}\``), `install rules do not require ${field}`)
}
check(installText.includes('不得使用 `package.json`'), 'install rules do not reject package.json as public release truth')
check(installText.includes('无法在线核验时，只返回发布页面'), 'missing offline Releases-page-only rule')
check(resolverText.includes('MARKER="install-and-upgrade.md"'), 'resolver marker is not install-and-upgrade.md')

const allowedReleaseUrls = new Set([releasePage, latestReleaseApi])
for (const path of relatedFiles) {
  const content = readFileSync(path, 'utf8')
  const urls = content.match(/https:\/\/[^\s)`"']+/gu) ?? []
  for (const url of urls) {
    if (url.includes('/releases')) {
      check(allowedReleaseUrls.has(url), `${path}: unsupported release URL ${url}`)
    }
  }
}

const semanticVersionPattern = /(?<![\d.@])v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?(?![\d.])/gu
for (const path of relatedFiles) {
  let content = readFileSync(path, 'utf8')
  if (path.endsWith('/SKILL.md')) content = content.replace(/^---\n[\s\S]*?\n---\n/u, '')
  if (path.endsWith('/evals/evals.json')) content = content.replace(/^\s*"version":.*$/gmu, '')
  if (path.endsWith('/INSTALL.md')) {
    content = content
      .split('\n')
      .filter((line) => !line.includes('Node.js'))
      .join('\n')
  }
  check(!semanticVersionPattern.test(content), `${path}: contains a hardcoded application-like version`)
  semanticVersionPattern.lastIndex = 0
}

const evalDocument = JSON.parse(read('skills/shell-manage-assistant/evals/evals.json'))
check(Array.isArray(evalDocument.evals), 'evals must be an array')
check(evalDocument.evals?.length === 10, `expected exactly 10 evals, found ${evalDocument.evals?.length ?? 0}`)
const evalIds = new Set()
for (const [index, evalCase] of (evalDocument.evals ?? []).entries()) {
  check(typeof evalCase.id === 'string' && evalCase.id.length > 0, `eval ${index + 1}: missing id`)
  check(!evalIds.has(evalCase.id), `eval ${index + 1}: duplicate id ${evalCase.id}`)
  evalIds.add(evalCase.id)
  check(typeof evalCase.prompt === 'string' && evalCase.prompt.length > 0, `eval ${index + 1}: missing prompt`)
  check(
    Array.isArray(evalCase.expected_behaviors)
      && evalCase.expected_behaviors.length > 0
      && evalCase.expected_behaviors.every((behavior) => typeof behavior === 'string' && behavior.length > 0),
    `eval ${index + 1}: expected_behaviors must contain non-empty strings`
  )
}

const resolver = spawnSync(
  'bash',
  [join(skillRoot, 'scripts/resolve-knowledge-root.sh'), '--verify', '--json'],
  { encoding: 'utf8' }
)
check(resolver.status === 0, `knowledge resolver failed: ${resolver.stderr.trim()}`)
if (resolver.status === 0) {
  const result = JSON.parse(resolver.stdout)
  check(resolve(result.path) === resolve(referencesRoot), 'knowledge resolver returned the wrong path')
  check(result.source === 'skill-local', 'knowledge resolver returned the wrong source')
  check(Array.isArray(result.missing) && result.missing.length === 0, 'knowledge resolver reported missing files')
}

const fixtureRoot = mkdtempSync(join(tmpdir(), 'shell-manage-skill-validator-'))
try {
  const validFixture = join(fixtureRoot, 'valid.yaml')
  const invalidFixture = join(fixtureRoot, 'invalid.yaml')
  const configValidator = join(skillRoot, 'scripts/validate-config-structure.sh')
  writeFileSync(validFixture, 'commands: []\npresets: []\nsettings: {}\n')
  writeFileSync(invalidFixture, 'commands: []\npresets: []\n')

  const valid = spawnSync('bash', [configValidator, '--json', validFixture], { encoding: 'utf8' })
  check(valid.status === 0, `valid YAML fixture was rejected: ${valid.stdout || valid.stderr}`)
  if (valid.stdout) check(JSON.parse(valid.stdout).valid === true, 'valid YAML result did not report valid: true')

  const invalid = spawnSync('bash', [configValidator, '--json', invalidFixture], { encoding: 'utf8' })
  check(invalid.status !== 0, 'invalid YAML fixture was accepted')
  if (invalid.stdout) {
    const result = JSON.parse(invalid.stdout)
    check(result.valid === false, 'invalid YAML result did not report valid: false')
    check(result.errors.some((error) => error.includes('settings')), 'invalid YAML result did not identify missing settings')
  }
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true })
}

if (errors.length > 0) {
  for (const error of errors) console.error(`error: ${error}`)
  process.exit(1)
}

console.log('shell-manage-assistant validation passed: release rules, 10 evals, resolver, YAML fixtures')
