import appIcon from '../../resources/icons/icon.png'
import aiQuery from '../../docs/website/软件截屏/8.AI查服务器日志.png'
import aiSettings from '../../docs/website/软件截屏/7.AI.png'
import browser from '../../docs/website/软件截屏/3.浏览器.png'
import collaborationDirectories from '../../docs/website/软件截屏/6.协作2.png'
import collaborationScripts from '../../docs/website/软件截屏/6.协作1.png'
import commandHome from '../../docs/website/软件截屏/1.首页.png'
import monitoring from '../../docs/website/软件截屏/4.监控.png'
import runningLog from '../../docs/website/软件截屏/2.运行日志.png'
import sshKeys from '../../docs/website/软件截屏/5.密钥.png'

export type ScreenshotId =
  | 'command-home'
  | 'running-log'
  | 'browser'
  | 'monitoring'
  | 'ssh-keys'
  | 'collaboration-scripts'
  | 'collaboration-directories'
  | 'ai-settings'
  | 'ai-query'

export interface ScreenshotAsset {
  src: string
  alt: string
  width: number
  height: number
}

const dimensions = { width: 3456, height: 1976 }

export const screenshots: Record<ScreenshotId, ScreenshotAsset> = {
  'command-home': {
    src: commandHome,
    alt: 'ShellManage 命令首页，多个本地项目的运行状态集中显示',
    ...dimensions
  },
  'running-log': {
    src: runningLog,
    alt: 'ShellManage 运行日志页，显示项目状态、实时输出和重新启动操作',
    ...dimensions
  },
  browser: {
    src: browser,
    alt: 'ShellManage 内置浏览器，显示本地项目和常用网页入口',
    ...dimensions
  },
  monitoring: {
    src: monitoring,
    alt: 'ShellManage 监控页，显示 CPU、内存、磁盘和网络状态',
    ...dimensions
  },
  'ssh-keys': {
    src: sshKeys,
    alt: 'ShellManage SSH 密钥页，管理保存在本机的私钥',
    ...dimensions
  },
  'collaboration-scripts': {
    src: collaborationScripts,
    alt: 'ShellManage 协作页，显示可执行和分享的发版脚本',
    ...dimensions
  },
  'collaboration-directories': {
    src: collaborationDirectories,
    alt: 'ShellManage 协作页，使用项目名称管理本机项目目录',
    ...dimensions
  },
  'ai-settings': {
    src: aiSettings,
    alt: 'ShellManage AI 设置页，配置模型、API Key 和服务地址',
    ...dimensions
  },
  'ai-query': {
    src: aiQuery,
    alt: 'ShellManage 会话终端，通过 AI 查询远程服务器的内存状态',
    ...dimensions
  }
}

export { appIcon }
