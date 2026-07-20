# 配置写入标准流程（ShellManage Skill）

本流程用于所有配置变更请求，目标是「可解释、可回滚、低误改」。

## Workflow 总览

1. Read（读取）
2. Validate（校验）
3. Draft（生成增量草案）
4. Confirm（用户确认）
5. Apply（写入）
6. Re-Validate（写后复检）
7. Report（结果回报）

## 1) Read

- 读取完整配置文本（不要只读局部）。
- 记录操作目标：新增/覆盖/删除命令，是否触及 `settings`。

## 2) Validate

最小校验：

- YAML 语法可解析
- 顶层存在 `commands`、`presets`、`settings`
- `commands` 是数组

失败时不得写入，先回报修复建议。

## 3) Draft

- 仅生成「最小必要改动」
- 默认只改 `commands`
- 对候选命令执行门禁：
  - 脚本存在或入口可验证
  - 启动探测成功（短时）

## 4) Confirm

写入前必须告诉用户：

- 将新增/修改哪些命令名
- 是否改动 `settings` 或 `presets`
- 是否存在覆盖行为

未确认不写入。

## 5) Apply

- 按草案写回配置
- 保留未触及字段原样

## 6) Re-Validate

写后立即再做一次结构校验。

建议额外校验：

- 新增命令字段齐全
- 无重复 `name`

## 7) Report

固定报告内容：

1. 操作状态：成功/失败
2. 实际变更项（命令名列表）
3. 未变更项（例如 `presets`、`settings`）
4. 回滚建议（恢复前一版本配置）

## 高风险操作规则

以下操作需要「二次确认」：

- 覆盖同名命令
- 删除命令
- 改动 `settings`

## 推荐返回模板

```markdown
计划变更:
- 新增: [xxx, yyy]
- 修改: [zzz]
- 未改动: [presets, settings]

请确认是否写入（yes/no）
```
