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

私有仓库推送 `v*` Tag 后，`.github/workflows/sync-public.yml` 会自动执行 `scripts/sync-to-public.sh`，将该 Tag 对应且允许公开的源码同步到 `liuzhuang/shell-manage`，再推送同名 Tag。公开仓库收到 Tag 后自动构建并发布 GitHub Release。在私有仓库 Actions Secrets 中配置对公开仓库具有 Contents 与 Workflows 读写权限的 fine-grained token：`PUBLIC_REPO_TOKEN`。

`.github/workflows/release.yml` 由公开仓库的 `v*` Tag 触发，版本号必须与 `package.json` 一致，并构建以下产物发布到 GitHub Releases：

- Windows x64：NSIS `.exe`
- macOS Intel：`x64.dmg` 与更新用 ZIP
- macOS Apple Silicon：`arm64.dmg` 与更新用 ZIP
- `latest.yml`、`latest-mac.yml` 和 blockmap 更新元数据

当前 workflow 生成未签名预览版，不需要配置 Apple Developer 或 Windows 代码签名 Secrets。macOS 客户端通过 GitHub Releases 检查新版本并引导手动下载；Windows 客户端读取 `latest.yml` 自动下载与安装，但安装程序可能显示「未知发布者」或 SmartScreen 提示。

在私有仓库执行发版命令。它会自动增加补丁版本、创建版本提交和 Tag，并推送到私有仓库：

```bash
npm run release:patch
```

Tag 同步成功后，公开仓库自动构建并公开 Draft Release。Windows 客户端随后从该公开版本读取自动更新元数据。

## 发布前检查

```bash
npm run typecheck
npm run build
npm run website:build
git diff --check
```

还需要确认：

- Release 同时包含安装包、ZIP、blockmap 和 `latest*.yml`。
- 官网下载入口指向 `https://github.com/liuzhuang/shell-manage/releases`。
