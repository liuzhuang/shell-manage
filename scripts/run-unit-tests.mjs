import { spawnSync } from 'node:child_process'
import { access, readdir } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const childMarker = 'SHELL_MANAGE_UNIT_TEST_CHILD'
const electronStubUrl = 'data:text/javascript,export const app={getPath:()=>process.env.SHELL_MANAGE_HOME||process.cwd()}'

async function findTests(directory) {
  const tests = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) tests.push(...await findTests(path))
    else if (entry.name.endsWith('.test.ts')) tests.push(path)
  }
  return tests.sort()
}

async function main() {
  const sourceDirectory = fileURLToPath(new URL('../src', import.meta.url))
  const tests = await findTests(sourceDirectory)
  if (tests.length === 0) throw new Error('No *.test.ts files found under src/')

  const result = spawnSync(process.execPath, [
    '--experimental-transform-types',
    '--import',
    `data:text/javascript,import{register}from'node:module';register(${JSON.stringify(import.meta.url)})`,
    '--test',
    ...tests
  ], {
    stdio: 'inherit',
    env: { ...process.env, [childMarker]: '1' }
  })

  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') return { url: electronStubUrl, shortCircuit: true }
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const canResolveTypeScript = error?.code === 'ERR_MODULE_NOT_FOUND'
      && context.parentURL?.startsWith('file:')
      && (specifier.startsWith('.') || specifier.startsWith('file:'))
      && extname(new URL(specifier, context.parentURL).pathname) === ''
    if (!canResolveTypeScript) throw error

    const unresolvedPath = fileURLToPath(new URL(specifier, context.parentURL))
    for (const suffix of ['.ts', '/index.ts']) {
      const candidate = `${unresolvedPath}${suffix}`
      try {
        await access(candidate)
        return nextResolve(pathToFileURL(candidate).href, context)
      } catch {}
    }
    throw error
  }
}

if (process.env[childMarker] !== '1') await main()
