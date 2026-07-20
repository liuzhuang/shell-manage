# 安装 shell-manage-assistant

`shell-manage-assistant` 用于分析项目、验证启动命令，并在确认后把命令写入 ShellManage 配置。安装使用 `skills` CLI，不需要手动判断 AI 编程工具的 Skill 目录。

安装源位于公开仓库 `liuzhuang/shell-manage`。

## 运行条件

- macOS
- Node.js 22.20.0 或更高版本
- npm、npx 和 Git
- 可以访问 GitHub 的网络环境
- 目标用户目录具有写权限

先检查本机环境：

```bash
node --version
npx --version
git --version
```

Node.js 版本不符合要求时，从 [Node.js 官网](https://nodejs.org/) 安装当前受支持版本。

## 安装

在终端执行：

```bash
npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy
```

参数含义：

- `--global`：安装到用户级目录，在不同项目中使用同一 Skill。
- `--copy`：复制完整 Skill，不创建符号链接。
- 不使用 `--yes`：覆盖同名 Skill 前保留确认步骤。

命令运行后，按提示选择已识别的 AI 编程工具并确认安装。安装内容包括 `SKILL.md`、`references/`、`scripts/`、`evals/` 和本文件。

## 验证

查看全局安装结果：

```bash
npx skills@latest list --global
```

列表包含 `shell-manage-assistant` 后，重新打开 AI 编程工具。如果当前会话仍未识别该 Skill，重启对应工具再检查。

安装成功只表示文件已经复制。实际发现和调用行为以对应 AI 编程工具的当前规则为准。

## 使用

可以显式要求 AI 调用：

```text
使用 $shell-manage-assistant 分析当前项目，并把验证通过的启动命令接入 ShellManage。
```

ShellManage 的「添加命令 → AI 添加」会生成同类提示词；Skill 不可用时，提示词仍包含完整的通用接入步骤。

## 更新

检查并更新全局安装的 Skill：

```bash
npx skills@latest update shell-manage-assistant --global
```

更新前核对 CLI 显示的来源和覆盖提示。不要添加 `--yes`，避免跳过覆盖确认。

## WorkBuddy

当前 `skills` CLI 的支持列表不包含 WorkBuddy。需要在 WorkBuddy 中使用时，按照 WorkBuddy 的「添加技能 → 上传技能」流程，导入完整的 `skills/shell-manage-assistant/` 包，不要只导入单独的 `SKILL.md`。

## 匿名遥测

`skills` CLI 默认发送匿名使用数据。需要关闭时，在命令前设置：

```bash
DISABLE_TELEMETRY=1 npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy
```

也可以设置 `DO_NOT_TRACK=1`。

## 常见问题

### 无法访问安装源

确认可以访问 GitHub，并检查 Git 使用的网络与认证方式。

### 检测不到 AI 编程工具

根据 CLI 提示手动选择目标工具。仓库不维护客户端目录映射，也不建议绕过 CLI 直接猜测安装目录。

### 已存在同名 Skill

确认现有内容可以被替换后再继续。CLI 会替换同名 Skill 的完整目录，不会合并其中的个人修改。

## 卸载

通过 CLI 移除全局安装：

```bash
npx skills@latest remove shell-manage-assistant --global
```

执行前核对 CLI 显示的目标工具和目录，避免移除其他 Skill。
