# ShellManage Skills

本目录保存 ShellManage 的 Agent Skills 源码。仓库内的 Skill 目录用于开发和分发，不等同于任一客户端的已安装目录。

## 当前 Skill

| Skill | 源码路径 | 参考资料 |
|---|---|---|
| `shell-manage-assistant` | `skills/shell-manage-assistant/` | `skills/shell-manage-assistant/references/` |

目录结构：

```text
skills/shell-manage-assistant/
├── SKILL.md
├── INSTALL.md
├── references/
├── scripts/
└── evals/evals.json
```

## 安装

使用 `skills` CLI 选择已识别的 AI 编程工具，并把完整 Skill 复制到用户级目录：

```bash
npx skills@latest add https://github.com/liuzhuang/shell-manage/tree/main/skills/shell-manage-assistant --global --copy
```

客户端识别和实际安装目录由 `skills` CLI 处理，仓库不维护各客户端的目录映射。

完整说明见 [shell-manage-assistant/INSTALL.md](shell-manage-assistant/INSTALL.md)。

## 格式与依赖

Skill 使用 `SKILL.md` frontmatter、按需读取的 `references/`、辅助 `scripts/` 和回归样例 `evals/`。随附脚本需要 `bash` 和 `ruby`；运行前应先确认这两个命令存在。

Skill 中的产品下载清单目前仍是占位模板，不能据此提供公开下载地址。详见 [下载、安装与升级](shell-manage-assistant/references/install-and-upgrade.md)。
