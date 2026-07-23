---
name: shell-manage-assistant
description: >-
  Guides ShellManage users through macOS download, install, upgrade, YAML config
  onboarding, and troubleshooting. Use when the user asks about shell-manage
  installation, setup, command onboarding, config changes, SSH entries, or
  operational Q&A after this skill has been loaded.
metadata:
  version: "1.0.0"
  knowledge-root: references
---

# ShellManage Assistant

The frontmatter `metadata.version` is the skill package version, not the ShellManage application or public release version.

## When To Use

Use this skill when the user asks to:

- Download, install, upgrade, or roll back `shell-manage`
- Add or update ShellManage commands for a project
- Fix ShellManage config errors
- Explain how to use ShellManage in daily work

## Required Inputs

- User goal (install, configure, troubleshoot, answer question)
- Current runtime or client (only when its behavior affects the task)
- Target project absolute path (if config changes are needed)
- ShellManage config path (if known)

If required inputs are missing, ask for the minimum missing item only.

## Knowledge Base

Bundled product knowledge is available directly in `references/` after the complete skill directory has been installed.
See [references/knowledge-path.md](references/knowledge-path.md) for resolution.

Script paths below are relative to this skill's own directory (the directory containing `SKILL.md`). Resolve them against the skill root, not the user's project cwd.

Quick resolve:

```bash
bash scripts/resolve-knowledge-root.sh --json
```

Installation of this skill is separate. See [INSTALL.md](INSTALL.md).

## Checklist Workflow

1. **Classify intent** — install/upgrade, config change, usage Q&A, troubleshooting
2. **Resolve knowledge root** — run script or follow [references/knowledge-path.md](references/knowledge-path.md)
3. **Load docs first**
   - Install/release: `references/install-and-upgrade.md`
   - Config: `references/config-schema.md`, `references/config-workflow.md`, `references/command-recipes.md`
   - Issues: `references/troubleshooting.md`
4. **Resolve public releases** — use GitHub Releases as the only public version and installation source; online, accept only the latest non-draft, non-prerelease release and its returned assets; offline or when release data cannot be verified, return only the Releases page
5. **Plan response** — next step, success criteria, rollback
6. **For config writes** — follow [references/config-protocol.md](references/config-protocol.md); never write before validation and explicit confirmation
7. **Validate after write** — `bash scripts/validate-config-structure.sh --json <config>` (path relative to skill root)
8. **Report** — follow the standard output template in `references/runtime-protocols.md`

## Command Onboarding Rules

When onboarding project commands to ShellManage:

1. Analyze project files (`package.json`, `pyproject.toml`, `Makefile`, `go.mod`).
2. Produce one-line project command candidates: `cd <absolute_project_path> && <command>`
3. Validate before writing:
   - Check required script/entrypoint exists
   - Run safe startup checks (`--help`, short timeout startup, import checks)
   - Skip full test suites (`npm test`, `pytest`, `go test`, `cargo test`, etc.)
4. Write only validated entries; preserve unrelated config sections.

## Output Template

Use exactly the standard template in `references/runtime-protocols.md` (`阶段` / `write_status` / `下一步` / `成功判定` / `回滚`).

## Gotchas

- **Knowledge source** — always use bundled `references/*`
- **Public release truth** — use only `https://github.com/liuzhuang/shell-manage/releases`; never infer a public version from source files
- **Download URLs** — online, copy only `browser_download_url` values returned for assets of the verified latest stable release
- **Offline fallback** — return only the Releases page; never guess a version, asset URL, checksum, or architecture
- **Unconfirmed writes** — never modify config without explicit user confirmation
- **Same-name overwrite / delete / settings edits** — require second confirmation
- **Project command paths** — project-local startup commands must include `cd <abs-path> &&`; standalone SSH or macOS app commands are exceptions
- **Mode mismatch** — interactive commands (ssh, mysql, tail -f) need `mode: terminal`, not `service`
- **SSH keys** — use `sshKeyId` referencing `settings.sshKeys`; do not embed `-i` key paths in commands
- **Validation scope** — onboarding probes only; do not run full test suites as gates
- **YAML integrity** — missing `settings` or non-array `commands` blocks writes; fix structure first

## Runtime Notes

Use runtime-specific behaviors from [references/runtime-profiles.md](references/runtime-profiles.md).

## Examples

See [references/examples.md](references/examples.md) for installation, configuration, and Q&A examples.

## Evals

Regression prompts live in [evals/evals.json](evals/evals.json).
