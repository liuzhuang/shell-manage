import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { DetectedProject, DetectedProjectType } from '../shared/types'

const DEFAULT_MAX_DEPTH = 4
const DEFAULT_MAX_DIRS = 2000
const IGNORE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  'target',
  'venv',
  '.venv',
  '__pycache__'
])

type PkgManager = 'npm' | 'pnpm' | 'yarn'

interface PackageJsonInfo {
  deps: Record<string, string>
  scripts: Record<string, string>
}

interface DirectoryFeatures {
  packageJson?: PackageJsonInfo
  packageManager: PkgManager
  hasPyProject: boolean
  hasRequirements: boolean
  hasSetupPy: boolean
  hasManagePy: boolean
  hasPomXml: boolean
  hasGradle: boolean
  hasGradleKts: boolean
  hasAppVue: boolean
  hasViteConfig: boolean
  pyProjectText?: string
  pomXmlText?: string
  gradleText?: string
}

interface DetectionCandidate {
  type: DetectedProjectType
  confidence: number
  evidence: string[]
  command: string
}

interface DetectOptions {
  maxDepth?: number
  maxDirs?: number
}

export async function detectProjectsFromRoot(rootPath: string, options: DetectOptions = {}): Promise<DetectedProject[]> {
  const maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH)
  const maxDirs = Math.max(100, options.maxDirs ?? DEFAULT_MAX_DIRS)
  const queue: Array<{ path: string; depth: number }> = [{ path: rootPath, depth: 0 }]
  const visited = new Set<string>()
  const results: DetectedProject[] = []
  const seenRoots = new Set<string>()
  let scannedDirs = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    if (visited.has(current.path)) continue
    visited.add(current.path)
    scannedDirs += 1
    if (scannedDirs > maxDirs) break

    const features = await detectDirectoryFeatures(current.path)
    const candidate = buildDetectionCandidate(current.path, features)
    if (candidate && !seenRoots.has(current.path)) {
      seenRoots.add(current.path)
      results.push({
        type: candidate.type,
        name: basename(current.path),
        rootPath: current.path,
        command: candidate.command,
        mode: 'service',
        tags: [],
        confidence: candidate.confidence,
        evidence: candidate.evidence
      })
    }

    if (current.depth >= maxDepth) continue
    const children = await safeReadDirs(current.path)
    for (const child of children) {
      if (IGNORE_DIRS.has(child)) continue
      queue.push({ path: join(current.path, child), depth: current.depth + 1 })
    }
  }

  return results
}

async function detectDirectoryFeatures(dir: string): Promise<DirectoryFeatures> {
  const packageJsonPath = join(dir, 'package.json')
  const pyProjectPath = join(dir, 'pyproject.toml')
  const requirementsPath = join(dir, 'requirements.txt')
  const setupPyPath = join(dir, 'setup.py')
  const managePyPath = join(dir, 'manage.py')
  const pomXmlPath = join(dir, 'pom.xml')
  const gradlePath = join(dir, 'build.gradle')
  const gradleKtsPath = join(dir, 'build.gradle.kts')
  const appVuePath = join(dir, 'src', 'App.vue')
  const viteConfigCandidates = ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs']

  const packageJson = await tryReadPackageJson(packageJsonPath)
  const pyProjectText = await tryReadTextFile(pyProjectPath)
  const pomXmlText = await tryReadTextFile(pomXmlPath)
  const gradleText = (await tryReadTextFile(gradlePath)) ?? (await tryReadTextFile(gradleKtsPath))
  const packageManager = await resolvePackageManager(dir)

  let hasViteConfig = false
  for (const name of viteConfigCandidates) {
    if (await fileExists(join(dir, name))) {
      hasViteConfig = true
      break
    }
  }

  return {
    packageJson,
    packageManager,
    hasPyProject: Boolean(pyProjectText),
    hasRequirements: await fileExists(requirementsPath),
    hasSetupPy: await fileExists(setupPyPath),
    hasManagePy: await fileExists(managePyPath),
    hasPomXml: Boolean(pomXmlText),
    hasGradle: await fileExists(gradlePath),
    hasGradleKts: await fileExists(gradleKtsPath),
    hasAppVue: await fileExists(appVuePath),
    hasViteConfig,
    pyProjectText,
    pomXmlText,
    gradleText
  }
}

function buildDetectionCandidate(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  return (
    detectNext(dir, features) ||
    detectVue(dir, features) ||
    detectReact(dir, features) ||
    detectPython(dir, features) ||
    detectJava(dir, features)
  )
}

function detectNext(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  const pkg = features.packageJson
  if (!pkg) return undefined
  const hasNextDep = Boolean(pkg.deps.next)
  const hasNextScript = Object.values(pkg.scripts).some((script) => /\bnext\s+(dev|start)\b/.test(script))
  if (!hasNextDep && !hasNextScript) return undefined
  const pm = features.packageManager
  const script = resolvePreferredScript(pkg.scripts, ['dev', 'start'])
  const runCommand = script ? toRunScriptCommand(pm, script) : 'npm run dev'
  return {
    type: 'nextjs',
    confidence: hasNextDep ? 0.95 : 0.85,
    evidence: [hasNextDep ? 'package.json dependencies 包含 next' : 'package.json scripts 包含 next dev/start'],
    command: joinCommand(dir, runCommand)
  }
}

function detectVue(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  const pkg = features.packageJson
  if (!pkg) return undefined
  const hasVueDep = Boolean(pkg.deps.vue)
  const likelyVueVite = features.hasViteConfig && features.hasAppVue
  if (!hasVueDep && !likelyVueVite) return undefined
  const pm = features.packageManager
  const script = resolvePreferredScript(pkg.scripts, ['dev', 'start'])
  const runCommand = script ? toRunScriptCommand(pm, script) : 'npm run dev'
  const evidence = []
  if (hasVueDep) evidence.push('package.json dependencies 包含 vue')
  if (likelyVueVite) evidence.push('命中 vite.config.* 且存在 src/App.vue')
  return {
    type: 'vue',
    confidence: hasVueDep ? 0.92 : 0.84,
    evidence,
    command: joinCommand(dir, runCommand)
  }
}

function detectReact(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  const pkg = features.packageJson
  if (!pkg) return undefined
  const hasReactDep = Boolean(pkg.deps.react)
  const hasNextDep = Boolean(pkg.deps.next)
  if (!hasReactDep || hasNextDep) return undefined
  const pm = features.packageManager
  const script = resolvePreferredScript(pkg.scripts, ['dev', 'start'])
  const runCommand = script ? toRunScriptCommand(pm, script) : 'npm run dev'
  return {
    type: 'react',
    confidence: 0.9,
    evidence: ['package.json dependencies 包含 react，且未命中 next'],
    command: joinCommand(dir, runCommand)
  }
}

function detectPython(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  if (!features.hasPyProject && !features.hasRequirements && !features.hasSetupPy && !features.hasManagePy) return undefined
  if (features.hasManagePy) {
    return {
      type: 'python',
      confidence: 0.93,
      evidence: ['存在 manage.py'],
      command: joinCommand(dir, 'python manage.py runserver')
    }
  }
  if (features.pyProjectText && /\[tool\.poetry\]/.test(features.pyProjectText)) {
    return {
      type: 'python',
      confidence: 0.88,
      evidence: ['pyproject.toml 命中 [tool.poetry]'],
      command: joinCommand(dir, 'poetry run python -m app')
    }
  }
  return {
    type: 'python',
    confidence: 0.8,
    evidence: ['命中 Python 特征文件（pyproject/requirements/setup.py）'],
    command: joinCommand(dir, 'python main.py')
  }
}

function detectJava(dir: string, features: DirectoryFeatures): DetectionCandidate | undefined {
  if (!features.hasPomXml && !features.hasGradle && !features.hasGradleKts) return undefined
  const springBootByPom = Boolean(features.pomXmlText && /spring-boot/i.test(features.pomXmlText))
  const springBootByGradle = Boolean(features.gradleText && /spring-boot/i.test(features.gradleText))
  if (features.hasPomXml) {
    return {
      type: 'java',
      confidence: springBootByPom ? 0.9 : 0.78,
      evidence: [springBootByPom ? 'pom.xml 命中 spring-boot' : '存在 pom.xml'],
      command: joinCommand(dir, springBootByPom ? 'mvn spring-boot:run' : 'mvn test')
    }
  }
  return {
    type: 'java',
    confidence: springBootByGradle ? 0.88 : 0.76,
    evidence: [springBootByGradle ? 'build.gradle 命中 spring-boot' : '存在 build.gradle/build.gradle.kts'],
    command: joinCommand(dir, springBootByGradle ? './gradlew bootRun' : './gradlew test')
  }
}

async function resolvePackageManager(dir: string): Promise<PkgManager> {
  if (await fileExists(join(dir, 'pnpm-lock.yaml'))) return 'pnpm'
  if (await fileExists(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm'
}

function resolvePreferredScript(scripts: Record<string, string>, preferred: string[]): string | undefined {
  for (const name of preferred) {
    if (typeof scripts[name] === 'string' && scripts[name].trim().length > 0) return name
  }
  return undefined
}

function toRunScriptCommand(pm: PkgManager, script: string): string {
  if (pm === 'npm') return `npm run ${script}`
  return `${pm} ${script}`
}

function joinCommand(projectPath: string, command: string): string {
  const safePath = projectPath.replace(/"/g, '\\"')
  return `cd "${safePath}" && ${command}`
}

async function tryReadPackageJson(path: string): Promise<PackageJsonInfo | undefined> {
  const text = await tryReadTextFile(path)
  if (!text) return undefined
  try {
    const json = JSON.parse(text) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      scripts?: Record<string, string>
    }
    return {
      deps: { ...(json.dependencies || {}), ...(json.devDependencies || {}) },
      scripts: json.scripts || {}
    }
  } catch {
    return undefined
  }
}

async function tryReadTextFile(path: string): Promise<string | undefined> {
  try {
    const data = await readFile(path, 'utf-8')
    return data
  } catch {
    return undefined
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path)
    return s.isFile()
  } catch {
    return false
  }
}

async function safeReadDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
  } catch {
    return []
  }
}
