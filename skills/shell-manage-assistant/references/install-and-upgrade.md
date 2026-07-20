# ShellManage 下载、安装与升级

本文件说明当前源码能够证实的安装能力，以及公开分发信息缺失时的处理边界。

## 当前状态

- `package.json` 中的源码版本为 `1.0.4`。
- 仓库已配置 electron-builder，并提供本地构建和检查 DMG 的脚本。
- `distribution-manifest.yaml` 仍是模板，包含 `example.com`、占位版本和占位 SHA-256。
- 当前仓库没有可作为公开下载依据的真实 URL、发布版本、历史版本或校验值。

源码版本和本地 DMG 构建能力不等同于已公开发布。安装、升级和回滚回答不得把模板值当成真实发布数据。

## 公开下载判断

回答公开下载问题前，依次检查：

1. 读取 `distribution-manifest.yaml`。
2. 检查所需通道是否有真实版本、产物 URL 和 SHA-256。
3. 检查 URL 是否仍指向 `example.com`，版本是否为占位值，SHA-256 是否仍为 `REPLACE_WITH_REAL_SHA256`。
4. 任一项仍为占位值时停止，不提供下载、升级或回滚步骤。

真实发布清单建立后，安装包类型、系统要求、可用架构和发布通道均以该清单及对应发布记录为准，不能从构建脚本的可选参数推断公开支持范围。

## 从源码构建本地 DMG

已有仓库副本时，可以在 macOS 本机执行：

```bash
npm install
npm run build:installer:mac
npm run verify:installer:mac
```

- `build:installer:mac` 先执行生产构建，再把 DMG 写入 `release/`。
- `verify:installer:mac` 检查 DMG 结构、App bundle、Applications 链接和随包资源。
- 这些脚本只验证本地产物，不发布文件，也不补充签名、公证或下载元数据。

如需使用非默认构建目标，应先核对脚本参数和实际验证结果，不能把脚本接受的参数直接写成对外支持声明。

## 安装已确认的 DMG

只有在真实发布元数据可用时，才执行以下流程：

1. 使用发布记录中的精确 URL 下载 DMG。
2. 按发布记录提供的 SHA-256 校验文件。
3. 挂载 DMG，将 `ShellManage.app` 拖入 `Applications`。
4. 启动应用并完成安装后检查。

仓库没有声明当前公开产物的签名或公证状态。遇到 macOS 启动拦截时，应记录系统提示并核对实际发布记录，不预设原因，也不默认建议绕过系统保护。

## 安装后检查

至少检查：

- 应用能够启动并显示主界面。
- 侧栏底部显示应用版本；当前源码构建应显示 `v1.0.4 Stable`。
- 「命令」页能够显示现有命令或导入演示命令。
- 「设置」页能够读取配置，状态显示为有效。
- 配置文件位于 `~/.shell-manage/config.yaml`，或 `SHELL_MANAGE_HOME` 指定目录下的 `.shell-manage/config.yaml`。

## 升级

升级需要真实目标版本和对应产物：

1. 从侧栏底部读取当前应用版本。
2. 从真实分发清单读取目标版本、产物 URL 和 SHA-256。
3. 确认目标版本更高，并备份 `~/.shell-manage/config.yaml`。
4. 完全退出应用，安装已校验的新 DMG。
5. 重新启动，检查命令、设置和至少一个已有运行任务。

缺少真实分发清单时，只能报告「无法确认公开最新版」，不能使用 `package.json` 推断线上版本。

## 回滚

回滚必须具备上一版本的真实安装包和校验信息：

1. 确认需要恢复的版本。
2. 从真实发布记录取得对应产物和 SHA-256。
3. 备份当前配置并完全退出应用。
4. 安装已校验的历史产物。
5. 检查配置结构和关键命令。

没有历史产物或发布记录时，应先请求补充，不编造下载地址，也不把本地构建产物当成已发布版本。

## 自动更新

公开版本使用 GitHub Releases。Windows 客户端读取 `latest.yml` 检查更新；当前 macOS 产物未签名，不启用自动更新，需要从 Release 页面手动下载安装。公开仓库的发布配置见 [`DEVELOPMENT.md`](../../../DEVELOPMENT.md)。

Release 尚未完成公开核验时，不能把源码中的更新能力描述为可用的公开更新服务。

## Skill 返回格式

安装类回答仍使用 [runtime-protocols.md](runtime-protocols.md) 中的标准字段。检测到分发占位符时：

- `阶段` 使用 `install`、`upgrade` 或 `troubleshoot`
- `write_status` 使用 `not_written`
- 「下一步」说明需要补充的真实发布元数据
- 「成功判定」说明清单中不再包含占位值
- 「回滚」说明本轮没有执行安装或配置写入
