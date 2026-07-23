# ShellManage 配置结构

默认配置文件路径：

```text
~/.shell-manage/config.yaml
```

## 顶层字段

应用要求以下字段存在：

- `commands`：命令数组
- `presets`：预设数组
- `settings`：全局设置对象

当前源码还使用以下可选字段：

- `projectDirectories`：协作页的项目目录
- `deployScripts`：协作页的脚本
- `activeDeployScriptId`：当前脚本 ID
- `dashboard`：可视化看板配置

## `commands`

每个命令的基础字段：

- `name`：命令显示名
- `command`：Shell 命令字符串
- `tags`：标签字符串数组，可以为空
- `mode`：`service` 或 `terminal`；省略时按 `service` 处理

常用可选字段：

- `sshKeyId`：引用 `settings.sshKeys[].id`
- `webUrl`：服务访问地址，例如 `http://localhost:3000`
- `iconDataUrl`：图标 Data URL
- `iconFilePath`：本地图标文件路径
- `autoRestart`：异常退出后是否自动重启或重连
- `maxRestarts`：自动重启或重连次数上限
- `healthCheck`：后台服务健康检查
- `terminalStartupSteps`：终端启动后的分步输入规则

`healthCheck.type` 只接受 `port` 或 `log`：

- `port` 必须包含 `port`，还可使用 `host`、`intervalSec`、`startupGraceSec` 和 `failureThreshold`
- `log` 必须包含非空 `pattern`，还可使用 `intervalSec`、`startupGraceSec` 和 `failureThreshold`

`terminalStartupSteps` 的每一步至少包含 `send`，还可包含：

- `delayMs`
- `waitForOutputPattern`
- `timeoutMs`
- `sendNewline`
- `label`

界面中的「手动填写命令」直接编辑 `name`、`command`、`tags`、`mode`、`sshKeyId`、`webUrl` 和 `autoRestart`。其余高级字段可在「设置」的 YAML 源码编辑中管理。

## `presets`

每个预设包含：

- `name`：预设名称
- `sequence`：按顺序执行的命令列表

`sequence` 条目包含 `command`，并可使用 `delay` 设置与下一项之间的等待秒数。停止预设时，应用按反向顺序停止其中的后台服务；交互终端不由预设启动或停止。

## `settings`

当前字段包括：

- `llm.provider`：`openai` 或 `deepseek`
- `llm.endpoint`
- `llm.apiKey`
- `llm.model`
- `langsmith`：可选的详细追踪配置；`apiKey` 有效时自动开启，不使用额外开关
- `tagOrder`：标签显示顺序
- `logViewPresets`：多日志视图预设
- `themePreset`：`system`、`coder` 或 `girl`
- `launchAtLogin`：登录 macOS 时是否启动应用
- `logBufferLines`：日志缓存行数
- `sshKeys`：SSH 密钥元数据数组；私钥内容不写入配置文件

`sshKeys` 条目包含 `id`、`label`，并可包含 `createdAt`。私钥文件由应用保存在 `~/.shell-manage/keys/`。

## 协作字段

`projectDirectories` 条目包含 `id`、`name`、`path`，并可包含 `createdAt`。

`deployScripts` 条目包含 `id`、`name`、`content`，还可包含 `sshKeyRef`、`deployTarget`、`remoteDir` 和 `createdAt`。

「协作」页的复制功能生成 YAML 片段，只包含选择的项目名和脚本，不包含本机项目路径。该片段不是完整的 `config.yaml` 备份。

## 写入约束

1. 先读取并解析完整配置。
2. 默认只修改任务需要的字段。
3. 覆盖同名命令、删除命令或修改 `settings` 前再次确认。
4. 写入后重新读取，并使用应用校验或结构检查脚本复检。
