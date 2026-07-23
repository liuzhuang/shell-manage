# ShellManage 常见问题排查

## 1. 无法取得公开安装包

先请求 `https://api.github.com/repos/liuzhuang/shell-manage/releases/latest`：

1. 返回项是否为 `draft: false`、`prerelease: false`
2. `tag_name` 是否非空
3. `assets` 中是否存在匹配设备的真实安装资产
4. 下载地址是否直接来自该资产的 `browser_download_url`

任一项无法确认时，只返回 `https://github.com/liuzhuang/shell-manage/releases`。不尝试猜测版本、下载地址、SHA、架构或文件名，也不从 `package.json` 推断公开版本。

只有明确请求从源码构建且已有仓库副本时，才执行：

```bash
npm run build:installer:mac
npm run verify:installer:mac
```

## 2. 本地 DMG 构建或检查失败

按失败阶段处理：

1. `npm run build` 失败：先处理类型、依赖或生产构建错误。
2. electron-builder 失败：保留完整构建输出，核对实际失败步骤。
3. `verify:installer:mac` 失败：根据输出检查 DMG、App bundle、Applications 链接或随包资源。

仓库没有声明公开产物的签名和公证状态。启动被拦截时，记录 macOS 的原始提示并核对真实发布记录，不预设原因。

## 3. 命令卡片没有出现

依次检查：

1. 「命令」页当前标签是否筛掉了该命令；切换到「全部」。
2. `~/.shell-manage/config.yaml` 中是否存在对应 `commands` 条目。
3. 配置是否包含 `commands`、`presets` 和 `settings`，且能够通过应用校验。
4. `tags` 是否为数组。缺失或类型错误可能导致命令列表无法正常读取。

应用会监听配置文件变化。通过「设置」保存后仍未出现时，查看「配置状态」提示和主进程错误，不使用不存在的「刷新首页」按钮。

## 4. 命令启动后立即失败

依次检查：

1. 需要项目目录的命令是否包含正确的绝对目录，例如 `cd /abs/path && ...`。
2. `package.json`、入口脚本或可执行文件是否存在。
3. 交互命令是否误用了 `service`；SSH、REPL 和 `tail -f` 通常使用 `terminal`。
4. 对应日志页中的退出状态和原始错误。

修正后使用有时间边界的启动探测，不默认运行完整测试套件。

## 5. SSH 无法连接

依次检查：

1. 主机地址和用户名是否正确。
2. 命令是否使用 `mode: terminal`。
3. `sshKeyId` 是否对应 `settings.sshKeys[].id`。
4. 本机 `~/.shell-manage/keys/<id>.pem` 是否存在。
5. 命令中是否重复写入 `-i` 私钥路径。

应用会根据 `sshKeyId` 注入私钥参数。配置文件只保存密钥元数据，不保存私钥内容。

## 6. AI 日志分析不可用

在「设置」中核对：

- `settings.llm.endpoint`
- `settings.llm.apiKey`
- `settings.llm.model`

模型配置缺失时，日志页仍可查看输出和手动执行命令，但 AI 问答不可用。排查材料中不要复制真实 API Key。

## 7. 配置损坏

恢复顺序：

1. 先复制当前配置，保留排查证据。
2. 使用已有的可用备份恢复；应用没有在此处承诺自动生成历史版本。
3. 没有备份时，先修复 `commands`、`presets` 和 `settings` 顶层结构。
4. 每次只做一组最小修改，并在保存后重新校验。
