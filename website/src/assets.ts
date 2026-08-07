import appIcon from './images/app-icon-64.webp'
import aiQuery from '../../docs/website/软件截屏/8.AI查服务器日志.png'
import aiQuerySmall from './images/8.AI查服务器日志-960.webp'
import aiQueryLarge from './images/8.AI查服务器日志-1920.webp'
import aiSettings from '../../docs/website/软件截屏/7.AI.png'
import aiSettingsSmall from './images/7.AI-960.webp'
import aiSettingsLarge from './images/7.AI-1920.webp'
import browser from '../../docs/website/软件截屏/3.浏览器.png'
import browserSmall from './images/3.浏览器-960.webp'
import browserLarge from './images/3.浏览器-1920.webp'
import collaborationDirectories from '../../docs/website/软件截屏/6.协作2.png'
import collaborationDirectoriesSmall from './images/6.协作2-960.webp'
import collaborationDirectoriesLarge from './images/6.协作2-1920.webp'
import collaborationScripts from '../../docs/website/软件截屏/6.协作1.png'
import collaborationScriptsSmall from './images/6.协作1-960.webp'
import collaborationScriptsLarge from './images/6.协作1-1920.webp'
import commandHome from '../../docs/website/软件截屏/1.首页.png'
import commandHomeSmall from './images/1.首页-960.webp'
import commandHomeLarge from './images/1.首页-1920.webp'
import monitoring from '../../docs/website/软件截屏/4.监控.png'
import monitoringSmall from './images/4.监控-960.webp'
import monitoringLarge from './images/4.监控-1920.webp'
import runningLog from '../../docs/website/软件截屏/2.运行日志.png'
import runningLogSmall from './images/2.运行日志-960.webp'
import runningLogLarge from './images/2.运行日志-1920.webp'
import sshKeys from '../../docs/website/软件截屏/5.密钥.png'
import sshKeysSmall from './images/5.密钥-960.webp'
import sshKeysLarge from './images/5.密钥-1920.webp'

// ponytail: 静态预览避免部署时安装图片工具；替换原始截图后需重新生成对应 WebP。
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
  previewSmall: string
  previewLarge: string
  alt: string
  width: number
  height: number
}

const dimensions = { width: 3456, height: 1976 }

export const screenshots: Record<ScreenshotId, ScreenshotAsset> = {
  'command-home': {
    src: commandHome,
    previewSmall: commandHomeSmall,
    previewLarge: commandHomeLarge,
    alt: 'ShellManage 命令首页，多个本地项目的运行状态集中显示',
    ...dimensions
  },
  'running-log': {
    src: runningLog,
    previewSmall: runningLogSmall,
    previewLarge: runningLogLarge,
    alt: 'ShellManage 运行日志页，显示项目状态、实时输出和重新启动操作',
    ...dimensions
  },
  browser: {
    src: browser,
    previewSmall: browserSmall,
    previewLarge: browserLarge,
    alt: 'ShellManage 内置浏览器，显示本地项目和常用网页入口',
    ...dimensions
  },
  monitoring: {
    src: monitoring,
    previewSmall: monitoringSmall,
    previewLarge: monitoringLarge,
    alt: 'ShellManage 监控页，显示 CPU、内存、磁盘和网络状态',
    ...dimensions
  },
  'ssh-keys': {
    src: sshKeys,
    previewSmall: sshKeysSmall,
    previewLarge: sshKeysLarge,
    alt: 'ShellManage SSH 密钥页，管理保存在本机的私钥',
    ...dimensions
  },
  'collaboration-scripts': {
    src: collaborationScripts,
    previewSmall: collaborationScriptsSmall,
    previewLarge: collaborationScriptsLarge,
    alt: 'ShellManage 协作页，显示可执行和分享的发版脚本',
    ...dimensions
  },
  'collaboration-directories': {
    src: collaborationDirectories,
    previewSmall: collaborationDirectoriesSmall,
    previewLarge: collaborationDirectoriesLarge,
    alt: 'ShellManage 协作页，使用项目名称管理本机项目目录',
    ...dimensions
  },
  'ai-settings': {
    src: aiSettings,
    previewSmall: aiSettingsSmall,
    previewLarge: aiSettingsLarge,
    alt: 'ShellManage AI 设置页，配置模型、API Key 和服务地址',
    ...dimensions
  },
  'ai-query': {
    src: aiQuery,
    previewSmall: aiQuerySmall,
    previewLarge: aiQueryLarge,
    alt: 'ShellManage 会话终端，通过 AI 查询远程服务器的内存状态',
    ...dimensions
  }
}

export { appIcon }
