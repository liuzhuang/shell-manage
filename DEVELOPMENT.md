# 开发与部署

本文档说明 ShellManage 桌面应用与官网的本地开发、构建和发布流程。

## 环境要求

- Node.js `^20.19.0 || >=22.12.0`
- npm
- macOS 或 Windows；本地安装器命令主要面向 macOS

## 本地开发

安装锁定依赖并启动 Electron 开发环境：

```bash
npm ci
npm run dev
```

提交前至少运行：

```bash
npm run typecheck
npm run build
```

完整端到端测试：

```bash
npm run test:e2e
```

`npm run build` 生成：

- `dist/main`：Electron 主进程
- `dist/preload`：预加载脚本
- `dist/renderer`：渲染进程

## 官网开发

```bash
npm run website:dev
npm run website:build
npm run test:website
```

官网静态文件生成到 `dist-website/`。部署时将该目录发布到静态托管服务。

## 本地安装包

macOS 本地构建与校验：

```bash
npm run build:installer:mac
npm run verify:installer:mac
```

安装包写入 `release/`。本地构建不等同于公开版本。

## GitHub 自动发版

`.github/workflows/release.yml` 只允许从默认分支手动触发。workflow 自动增加补丁版本号，构建以下产物并发布到 GitHub Releases：

- Windows x64：NSIS `.exe`
- macOS Intel：`x64.dmg` 与更新用 ZIP
- macOS Apple Silicon：`arm64.dmg` 与更新用 ZIP
- `latest.yml`、`latest-mac.yml` 和 blockmap 更新元数据

仓库需要配置以下 GitHub Actions Secrets：

```text
MAC_CSC_LINK
MAC_CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
WIN_CSC_LINK
WIN_CSC_KEY_PASSWORD
```

触发命令：

```bash
gh workflow run release.yml --repo liuzhuang/shell-manage --ref main
```

构建成功后，workflow 提交版本更新并公开 Draft Release。客户端随后从该公开版本读取自动更新元数据。

## 发布前检查

```bash
npm run typecheck
npm run build
npm run website:build
git diff --check
```

还需要确认：

- GitHub Actions Secrets 已配置且证书仍然有效。
- Release 同时包含安装包、ZIP、blockmap 和 `latest*.yml`。
- 官网下载入口指向 `https://github.com/liuzhuang/shell-manage/releases`。
