import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppConfig,
  DeployScriptConfig,
  DeployScriptExecuteRequest,
  DeployScriptValidateRequest
} from '../shared/types'
import { buildKnownSlotNames, buildSlotValues, collectTemplateSlots, renderTemplate } from './template-engine'

export const DEPLOY_TERMINAL_COMMAND_PREFIX = '__deploy__:'

export interface DeployScriptRenderResult {
  rendered: string
  missingSlots: string[]
  unknownSlots: string[]
  usedSlots: string[]
  knownSlots: string[]
}

export interface DeployScriptPreparedSession {
  terminalCommandName: string
  scriptId: string
  scriptName: string
  scriptPath: string
  commandLine: string
}

const deployScriptSessions = new Map<
  string,
  {
    scriptPath: string
    scriptName: string
    commandLine: string
  }
>()

export function toDeployTerminalCommandName(scriptId: string): string {
  return `${DEPLOY_TERMINAL_COMMAND_PREFIX}${scriptId}`
}

export function isDeployTerminalCommand(commandName: string): boolean {
  return commandName.startsWith(DEPLOY_TERMINAL_COMMAND_PREFIX)
}

export function getDeployScriptSession(commandName: string):
  | {
      scriptPath: string
      scriptName: string
      commandLine: string
    }
  | undefined {
  return deployScriptSessions.get(commandName)
}

export function renderDeployScriptContent(config: AppConfig, script: DeployScriptConfig): DeployScriptRenderResult {
  const projectDirectories = config.projectDirectories || []
  const sshKeys = config.settings.sshKeys || []
  const knownSlots = buildKnownSlotNames(projectDirectories, sshKeys)
  const usedSlots = collectTemplateSlots(script.content)
  const slotValues = buildSlotValues({ projectDirectories, sshKeys })
  const result = renderTemplate(script.content, slotValues, knownSlots)
  const unknownSlots = usedSlots.filter((slot) => !knownSlots.includes(slot))

  return {
    rendered: result.rendered,
    missingSlots: result.missingSlots,
    unknownSlots,
    usedSlots,
    knownSlots
  }
}

export async function prepareDeployScriptExecution(
  userDataPath: string,
  config: AppConfig,
  script: DeployScriptConfig
): Promise<DeployScriptPreparedSession> {
  const rendered = renderDeployScriptContent(config, script)
  if (rendered.missingSlots.length > 0) {
    throw new Error(`存在未填充插槽：${rendered.missingSlots.map((slot) => `{{${slot}}}`).join('、')}`)
  }
  if (rendered.unknownSlots.length > 0) {
    throw new Error(`存在未知插槽：${rendered.unknownSlots.map((slot) => `{{${slot}}}`).join('、')}`)
  }

  const scriptsDir = join(userDataPath, 'deploy-scripts')
  await mkdir(scriptsDir, { recursive: true })
  const scriptPath = join(scriptsDir, `${script.id}-${Date.now()}.sh`)
  await writeFile(scriptPath, rendered.rendered, 'utf8')
  await chmod(scriptPath, 0o755)

  const terminalCommandName = toDeployTerminalCommandName(script.id)
  const commandLine = `bash ${JSON.stringify(scriptPath)}`
  deployScriptSessions.set(terminalCommandName, {
    scriptPath,
    scriptName: script.name,
    commandLine
  })

  return {
    terminalCommandName,
    scriptId: script.id,
    scriptName: script.name,
    scriptPath,
    commandLine
  }
}

export function clearDeployScriptSession(commandName: string): void {
  deployScriptSessions.delete(commandName)
}

export function resolveDeployScriptInput(
  config: AppConfig,
  request: DeployScriptExecuteRequest | DeployScriptValidateRequest
): DeployScriptConfig {
  const scriptId = request.scriptId?.trim()
  if (!scriptId) {
    throw new Error('缺少 scriptId')
  }
  const scripts = config.deployScripts || []
  const found = scripts.find((item) => item.id === scriptId)
  if (!found) {
    throw new Error(`脚本不存在: ${scriptId}`)
  }
  if (request.content !== undefined) {
    return { ...found, content: request.content }
  }
  return found
}
