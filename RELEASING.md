# 发版说明

ShellManage 使用「私有仓库打 Tag、公开仓库构建 Release」的方式发版。版本号由命令自动增加，不需要手工填写。

## 一次性配置

私有仓库 `liuzhuang/test-shell` 需要配置：

- `PUBLIC_REPO_TOKEN`：允许 GitHub Actions 向 `liuzhuang/shell-manage` 推送源码、工作流和 Tag。

公开仓库 `liuzhuang/shell-manage` 需要配置：

- `SPARKLE_PRIVATE_KEY`：用于签名 macOS 更新 ZIP 和 appcast。该值必须与客户端内置的 `SUPublicEDKey` 配对。
- Secret `QUERY_RISK_EVAL_API_KEY`：用于发布前的真实模型风险评测，应使用独立且限额的密钥。
- Variable `QUERY_RISK_EVAL_MODEL`：评测模型名称，必须显式配置。
- Variable `QUERY_RISK_EVAL_PROVIDER`：可选，默认值为 `openai`。
- Variable `QUERY_RISK_EVAL_ENDPOINT`：可选，用于兼容服务或自建端点。
- Secret `SKILL_AGENT_EVAL_API_KEY`：用于发布前运行 10 个真实 ShellManage Assistant Agent 案例。
- Variable `SKILL_AGENT_EVAL_MODEL`：Skill Agent 评测模型名称，必须显式配置。
- Variable `SKILL_AGENT_EVAL_PROVIDER`、`SKILL_AGENT_EVAL_ENDPOINT`、`SKILL_AGENT_EVAL_TIMEOUT_MS`：可选的 provider、兼容端点和单次超时。
- Secret `LANGSMITH_API_KEY`：可选；配置后两类发布评测自动记录完整 trace。可用 `LANGSMITH_ENDPOINT`、`LANGSMITH_PROJECT` Variables 指定端点和项目。

从本机备份文件写入 Secret，不会在终端中显示私钥：

```bash
gh secret set SPARKLE_PRIVATE_KEY \
  --repo liuzhuang/shell-manage \
  < ~/.config/shell-manage/sparkle-private-key
```

私钥丢失后，已安装客户端无法验证使用新密钥签名的更新。应保留钥匙串副本和离线备份，不要把私钥提交到 Git。

## 发布前检查

在私有仓库执行：

```bash
npm ci
npm run typecheck
npm run test:unit
npm run test:skill
npm run test:skill-agent
npm run build
npm run website:build
git status --short
```

工作区应只包含计划发布的改动。确认 `main` 已推送后再执行发版命令。

## 发版命令

```bash
npm run release:patch
```

该命令会完成以下操作：

1. 使用 `npm version patch` 自动增加补丁版本。
2. 创建版本提交和同版本 Tag，例如 `v1.0.9`。
3. 将 `main` 和 Tag 推送到私有仓库。
4. 私有仓库的 `sync-public.yml` 将允许公开的源码同步到 `liuzhuang/shell-manage`。
5. 公开仓库的 `release.yml` 创建 Draft Release，构建 Windows x64、macOS Intel 和 macOS Apple Silicon 客户端。
6. 发布工作流使用真实模型运行 Query Agent 风险评测和 10 个 ShellManage Assistant Agent 案例；任何门禁失败都会停止发布。
7. macOS 构建使用 Sparkle EdDSA 私钥生成两份架构独立的签名 appcast。
8. 两类 Agent 评测和所有规定产物验证通过后，Draft Release 才会发布并标记为 Latest。

不要提前手工修改版本号，也不要手工创建同名 Tag。

## Release 产物

产物保存在公开仓库的 [GitHub Releases](https://github.com/liuzhuang/shell-manage/releases)，Actions 运行记录中也保留对应 Artifact。

| 平台 | 主要产物 |
| --- | --- |
| Windows x64 | `ShellManage-<version>-windows-x64-setup.exe`、`.blockmap`、`latest.yml` |
| macOS Intel | `ShellManage-<version>-macos-x64.dmg`、`ShellManage-<version>-macos-x64.zip` |
| macOS Apple Silicon | `ShellManage-<version>-macos-arm64.dmg`、`ShellManage-<version>-macos-arm64.zip` |
| macOS 更新索引 | `appcast-mac-x64.xml`、`appcast-mac-arm64.xml` |

## 自动更新方式

- Windows 使用 `electron-updater` 读取 GitHub Release 的 `latest.yml`，下载完成后提示安装。
- macOS 使用 Sparkle 2。客户端按当前 CPU 架构读取对应 appcast，点击更新后显示下载与准备进度，再自动退出、替换应用并重新启动。
- macOS 应用包使用 ad-hoc 签名，更新 ZIP 和 appcast 使用 EdDSA 签名。安装包仍没有 Apple Developer ID 签名和公证，首次打开时仍可能出现 Gatekeeper 提示。

旧版 macOS 客户端没有内置 Sparkle。首个包含 Sparkle 的桥接版本需要从 GitHub Releases 手动安装一次；从该版本升级到后续版本时才会进入完整自动更新流程。

## 发版后检查

```bash
gh run list --repo liuzhuang/test-shell --workflow sync-public.yml --limit 3
gh run list --repo liuzhuang/shell-manage --workflow release.yml --limit 3
gh release view --repo liuzhuang/shell-manage
```

还需要确认：

- 私有仓库版本、公开仓库版本、Tag 和 Release 版本一致。
- `Query Agent risk evaluation` 任务通过，没有关键危险用例被判为 `safe`。
- `ShellManage Assistant Agent evaluation` 的 10 个案例全部通过；配置 LangSmith 时可按 case、turn、tool 检查详细 trace。
- Release 不是 Draft，并包含上表中的安装包、ZIP 和更新索引。
- 未登录 GitHub 时可以下载 Release 资产。
- Windows 能从上一版本完成一次更新。
- macOS Intel 与 Apple Silicon 分别能从上一桥接版本完成一次下载、替换和重启。

## 失败恢复

构建或上传失败时，在原 Actions 运行中执行「Re-run failed jobs」。不要覆盖已经公开的版本或强制移动 Tag；修复代码后应发布更高的补丁版本。

如果 `sync-public.yml` 提示公开 Tag 已存在但指向不同提交，应停止发版并核对两个仓库，不要使用强制推送。
