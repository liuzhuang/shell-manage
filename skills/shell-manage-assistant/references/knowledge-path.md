# Skill 参考资料定位

Skill 规则和产品参考资料都位于 `skills/shell-manage-assistant/`。

## 定位顺序

当前只使用 Skill 自身携带的参考资料：

1. `<skill-root>/references/install-and-upgrade.md`

## 辅助脚本

以下路径相对于包含 `SKILL.md` 的 Skill 根目录：

```bash
bash scripts/resolve-knowledge-root.sh --json
```

检查参考资料是否完整；缺少必需文件时返回非零状态：

```bash
bash scripts/resolve-knowledge-root.sh --verify --json
```

退出状态：`0` 表示已找到；使用 `--verify` 时还表示文件完整。`1` 表示未找到或缺少文件，`2` 表示参数错误。

参考资料定位脚本需要 `bash`。另一个配置结构检查脚本 `validate-config-structure.sh` 还需要 `ruby`。

## 必需文件

| 文件 | 路径 |
|---|---|
| `install-and-upgrade.md` | `references/install-and-upgrade.md` |
| `config-schema.md` | `references/config-schema.md` |
| `config-workflow.md` | `references/config-workflow.md` |
| `command-recipes.md` | `references/command-recipes.md` |
| `troubleshooting.md` | `references/troubleshooting.md` |
| `runtime-protocols.md` | `references/runtime-protocols.md` |

`acceptance-cases.md` 和 `talk-track.md` 也随仓库提供，但当前 `--verify` 脚本不把它们列为完整性检查的必需文件。
