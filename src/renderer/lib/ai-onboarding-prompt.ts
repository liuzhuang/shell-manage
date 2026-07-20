export const ASSISTANT_SKILL_INSTALL_COMMAND =
  'npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy'

export const AI_ONBOARDING_STEPS = [
  '复制下方提示词',
  '在 Cursor / Claude / Codex 中粘贴，并 @ 你的项目',
  '回到 ShellManage 首页，新命令会自动出现'
] as const

export function buildAiOnboardingPrompt(params: {
  configPath: string
  existingCommandNames: string[]
}): string {
  const existingNames =
    params.existingCommandNames.length > 0 ? params.existingCommandNames.join(', ') : '（暂无）'

  return `你是 ShellManage（macOS 命令管理器）的配置助手。请优先调用 $shell-manage-assistant 完成当前项目的命令接入；如果该 Skill 不可用，则继续执行下方完整步骤。由你直接写入配置文件，用户不需要手动粘贴。

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
4. 自动写入配置文件：
   - 读取上述配置文件完整内容
   - 若 name 已在已有命令名列表中，跳过或询问用户是否覆盖
   - 将验证通过的命令追加到 commands: 数组，保留 presets、dashboard、settings 不变
   - 写入前自检 YAML 结构完整（commands / presets / settings 均存在）
   - 用文件编辑工具直接写回配置文件，不要只输出 YAML 让用户粘贴
5. 完成后告知用户：回到 ShellManage 首页即可看到新命令卡片（应用会自动刷新）

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
