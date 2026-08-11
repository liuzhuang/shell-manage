import { redactSensitiveText } from '../../shared/terminal-context'
import type { CommandPublicAccessProvider } from '../../shared/types'

export const ASSISTANT_SKILL_INSTALL_COMMAND =
  'npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy'

export const AI_ONBOARDING_STEPS = [
  '复制下方提示词',
  '粘贴给 Agent，审阅最小差异并明确确认',
  '回到 ShellManage 首页，新命令会自动出现'
] as const

export function buildAiOnboardingPrompt(params: {
  configPath: string
  existingCommandNames: string[]
}): string {
  const existingNames =
    params.existingCommandNames.length > 0 ? params.existingCommandNames.join(', ') : '（暂无）'

  return `你是 ShellManage（macOS 命令管理器）的配置助手。请优先调用 $shell-manage-assistant 完成当前项目的命令接入；如果该 Skill 不可用，则继续执行下方完整步骤。由你负责在确认后写入配置，用户无需手动粘贴 YAML；写入前必须展示拟修改内容并取得明确确认。

配置文件路径：${params.configPath}
已有命令名（不可重复）：${existingNames}

必须按顺序执行：
1. 分析当前项目：读取 package.json / pyproject.toml / Makefile / go.mod 等，找出最常用的 dev/start 启动命令。
2. 生成候选命令，格式必须是：cd <项目绝对路径> && <启动命令>
3. 验证门禁（写入前必须完成）：
   - 检查脚本或入口文件存在
   - 在终端实际验证（例如 npm run dev -- --help、python -c "import app"，或对长驻服务用 timeout 8s 短时启动）
   - 验证时只测启动/dev 命令，跳过单元测试：不要运行 npm test / pnpm test / yarn test、pytest / python -m pytest、gradle test / mvn test、go test、cargo test、jest / vitest 等测试用例；优先用 dev/start/serve 脚本或 --help / import 探测
   - 确认无立即报错；若失败则修正后重试，禁止写入未验证命令
4. 展示最小配置差异并请求确认：
   - 读取上述配置文件完整内容
   - 展示准备新增或修改的命令，以及明确不会改动的 presets、dashboard、settings
   - 未收到用户明确确认时不得写入
   - 若 name 已在已有命令名列表中，覆盖前必须再次确认；未确认则跳过
5. 确认后写入并复检配置文件：
   - 将确认且验证通过的命令追加到 commands: 数组，保留 presets、dashboard、settings 不变
   - 用文件编辑工具直接写回配置文件，不要只输出 YAML 让用户粘贴
   - 写入后重新读取，并自检 YAML 结构完整（commands / presets / settings 均存在）
6. 完成后告知用户：回到 ShellManage 首页即可看到新命令卡片（应用会自动刷新）

输出字段规则（对齐 ShellManage CommandConfig）：
- name: 唯一、简短（英文或拼音）
- command: 完整 shell 一行，目录写在 command 内（无独立 cwd 字段）
- tags: 数组，如 [前端]、[后端]
- mode: 默认 service；SSH、tail -f、mysql 等交互场景用 terminal
- sshKeyId: SSH 命令可选，引用 settings.sshKeys 中的密钥 ID（命令写 ssh user@host，不要写 -i 绝对路径）
- webUrl: 可选，dev server 有固定端口时填写，如 http://localhost:3000

SSH 团队共享示例：
  settings:
    sshKeys:
      - id: prod-root
        label: 生产 root
  commands:
    - name: prod-ssh
      command: ssh root@1.2.3.4
      tags: [运维]
      mode: terminal
      sshKeyId: prod-root

示例条目：
  - name: my-app
    command: cd /abs/path/to/project && npm run dev
    tags: [前端]
    mode: service
    webUrl: http://localhost:3000`
}

export function buildPublicAccessSetupPrompt(params: {
  configPath: string
  commandName: string
  command: string
  webUrl?: string
  provider: CommandPublicAccessProvider
}): string {
  const command = redactSensitiveText(params.command)
  const webUrl = params.webUrl ? redactSensitiveText(params.webUrl) : '（未配置）'
  const context = `你是 ShellManage 命令「${params.commandName}」的发布准备助手。你的职责仅限准备项目和本机 CLI；真正的发布或隧道启停由用户回到 ShellManage 操作。

ShellManage 配置文件：${params.configPath}
启动命令：${command}
当前 webUrl：${webUrl}`

  if (params.provider === 'vercel') {
    return `${context}

只准备 Vercel 云端长期发布：
1. 从启动命令开头的 cd "绝对路径" && 解析项目根目录，检查真实项目结构、框架和构建命令。不要把 ShellManage Electron 应用本身当作待发布项目。
2. 判断项目是否适合 Vercel。长驻进程、本地 SQLite、定时任务或依赖本机文件的服务不能原样部署；如需适配，先展示最小修改方案并取得用户明确确认后再改。
3. 使用 Vercel 官方 CLI，通过浏览器完成 vercel login，并在项目根目录执行 vercel link。不要读取、回显或保存 VERCEL_TOKEN。
4. 检查环境变量和 .vercelignore；运行 vercel deploy --dry --format=json --yes --non-interactive --no-color，审查上传清单并排除 .env、日志、数据库、私钥和其他敏感文件。
5. 禁止执行 vercel deploy --prod，也不要创建任何真实 deployment。
6. 最后报告登录、link、dry-run 和敏感文件检查结果；任何一项失败都要明确说明。
7. 全部准备成功后，明确告诉用户：“准备已完成，请返回 ShellManage，在对应命令卡片右上角打开「… → 发布」，然后在 Vercel 行点击「发布」。”不要代替用户执行生产发布。`
  }

  if (params.provider === 'cloudflare') {
    return `${context}

只准备 Cloudflare 海外临时链接：
1. 使用 Cloudflare 官方 cloudflared，完成安装并验证 cloudflared --version；Quick Tunnel 无需登录。
2. 确认该命令为 service 模式，webUrl 是带明确端口的 localhost、127.0.0.1 或 ::1 HTTP 地址。
3. 如需修改 mode 或 webUrl，先展示 ${params.configPath} 的最小差异并取得用户明确确认，只修改当前命令。
4. 禁止执行 cloudflared tunnel 或开启任何隧道。
5. 最后报告 cloudflared 版本和 ShellManage webUrl 检查结果；失败项必须明确说明。`
  }

  return `${context}

只准备 cpolar 国内临时链接：
1. 只使用 cpolar 官方 CLI 和官方文档，不安装或调用 cpolar-connect 等第三方工具。
2. 安装后验证 cpolar version；让用户在本地终端按官方流程完成实名和 authtoken，不要让用户把 token 发到聊天里。
3. 确认该命令为 service 模式，webUrl 是带明确端口的 localhost、127.0.0.1 或 ::1 HTTP 地址。
4. 若本地服务有 Host 校验（例如 Vite），验证它能接受 webUrl 对应的回环 Host；ShellManage 启动 cpolar 时会将 Host 显式重写为这个回环地址。不要把 cpolar 临时域名加入 server.allowedHosts，也不要设置 allowedHosts: true。
5. 提醒用户：若访问时出现 Blocked request 且 Host 是 "http:"，不要把 http: 加入 allowedHosts；请回到 ShellManage 停止并重新启动 cpolar 临时链接。
6. 如需修改 mode 或 webUrl，先展示 ${params.configPath} 的最小差异并取得用户明确确认，只修改当前命令。
7. 禁止执行 cpolar http 或开启任何隧道。
8. 最后报告 cpolar 版本、认证状态、ShellManage webUrl 和本地 Host 校验结果；失败项必须明确说明。`
}
