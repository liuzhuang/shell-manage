# 把启动命令导入 ShellManage

本文档供 Agent 读取。目标是分析当前项目、验证启动方式，并把可运行的命令写入已经安装好的 ShellManage。不要安装 ShellManage 应用，也不要只返回一段 YAML 让使用者手动复制。

## 1. 确认 ShellManage 已安装

默认配置文件位于：

```text
~/.shell-manage/config.yaml
```

如果文件不存在，停止写入，并要求先启动 ShellManage 完成初始化。不要代替使用者安装应用。

## 2. 准备 Assistant Skill

如果当前环境已经加载 `$shell-manage-assistant`，优先调用该 Skill。

如果尚未加载，可以执行：

```bash
npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy
```

CLI 会提示选择已识别的 Agent。不要添加 `--yes`，覆盖同名 Skill 前应保留确认步骤。

## 3. 分析当前项目

读取项目中的 `package.json`、`pyproject.toml`、`Makefile`、`go.mod` 或其他真实入口文件，找出最常用的 `dev`、`start` 或 `serve` 命令。

候选命令必须包含项目绝对路径：

```text
cd <项目绝对路径> && <启动命令>
```

## 4. 验证候选命令

写入前完成最小启动验证：

- 检查脚本、依赖声明或入口文件是否存在。
- 优先使用 `--help`、导入检查或不超过 8 秒的短时启动。
- 不运行单元测试或完整测试套件。
- 命令立即报错时先修正，不写入未验证的候选项。

## 5. 展示差异并取得确认

读取配置文件完整内容，先展示准备写入的最小差异，并明确列出不会改动的 `presets`、`dashboard`、`projectDirectories` 和 `settings`。未收到使用者明确确认时不得写入。

同名命令已经存在时，必须说明将覆盖的字段并再次取得专项确认；未确认则跳过。删除命令或修改 `settings` 也必须单独确认。

## 6. 确认后写入配置

读取配置文件完整内容，将验证通过的项目追加到 `commands` 数组。保留 `presets`、`dashboard`、`projectDirectories` 和 `settings` 等无关内容。

条目遵循以下字段：

- `name`：唯一、简短的名称。
- `command`：包含项目目录的完整 Shell 命令。
- `tags`：字符串数组。
- `mode`：常驻服务使用 `service`；SSH、`tail -f`、数据库终端等交互命令使用 `terminal`。
- `webUrl`：存在固定访问地址时填写。
- `sshKeyId`：SSH 命令需要引用已有密钥时填写。

写入前确认 `commands`、`presets` 和 `settings` 结构完整。只执行已经展示且获得确认的差异。

## 7. 完成检查

写入后重新读取配置，确认 YAML 可以解析且新增条目存在。最后说明：

1. 已新增或更新的命令名称。
2. 实际验证过的启动命令。
3. 回到 ShellManage 后，启动新命令并查看实时日志。
