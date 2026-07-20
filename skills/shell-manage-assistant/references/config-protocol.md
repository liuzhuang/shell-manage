# ShellManage 配置写入协议

## 写入顺序

所有配置写入按以下顺序执行：

1. 读取完整配置。
2. 解析并检查结构：
   - `commands` 是数组
   - `presets` 是数组
   - `settings` 是对象
3. 生成最小差异，并说明拟修改内容。
4. 请求明确确认。
5. 写入配置。
6. 重新读取并检查结构。
7. 报告已变更命令、未变更部分和回滚方式。

辅助检查命令相对于 Skill 根目录执行：

```bash
bash scripts/validate-config-structure.sh --json /path/to/config.yaml
```

`--json` 可以放在配置路径之前或之后。该脚本只检查顶层结构，不能替代应用自身对 `mode`、SSH 引用、健康检查等字段的校验。

## 命令字段

新命令至少包含：

- `name`：非空且不与现有命令同名
- `command`：非空的一行 Shell 命令
- `tags`：字符串数组，可以为空；为便于「命令」页筛选，通常应填写至少一个标签

项目内的启动命令应把工作目录写入 `command`：

```text
cd <项目绝对路径> && <启动命令>
```

独立 SSH 命令或通过「从 Applications 选择 App」生成的命令不要求使用上述形式。

常用可选字段：

- `mode`：`service` 或 `terminal`；缺省时按 `service` 处理
- `sshKeyId`：引用 `settings.sshKeys[].id`，仅在需要绑定 SSH 私钥时填写
- `webUrl`：稳定的 Web 地址，对应界面中的「Web 地址（可选）」
- `autoRestart`：后台服务异常退出后是否自动重启，或终端会话异常退出后是否自动重连
- `maxRestarts`：自动重启次数上限
- `healthCheck`：端口或日志健康检查
- `terminalStartupSteps`：终端会话建立后的分步输入规则
- `iconDataUrl`、`iconFilePath`：应用读取网站或 App 图标后保存的图标信息

完整结构见 [config-schema.md](config-schema.md)。

## 验证范围

- 不写入未核对入口文件或项目脚本的启动命令。
- 长驻服务使用有时间边界的启动探测。
- 项目接入时不把完整测试套件作为默认门禁。

## 需要再次确认的操作

- 覆盖同名命令
- 删除命令
- 修改 `settings`

## 返回格式

统一使用 [runtime-protocols.md](runtime-protocols.md) 中的 `阶段`、`write_status`、`下一步`、`成功判定` 和 `回滚` 字段。
