# ShellManage 下载、安装与升级

GitHub Releases 是 ShellManage 公开版本、安装包和升级信息的唯一事实源：

- 发布页面：`https://github.com/liuzhuang/shell-manage/releases`
- 最新正式版本 API：`https://api.github.com/repos/liuzhuang/shell-manage/releases/latest`

不得使用 `package.json`、构建配置、本地文件名、示例或缓存结果推断公开版本。

## 查询规则

网络可用时，请求最新正式版本 API，并同时满足以下条件：

1. HTTP 请求成功，返回对象中的 `draft` 为 `false`。
2. `prerelease` 为 `false`。
3. `tag_name` 非空。
4. 安装包只从该响应的 `assets` 中选择。
5. 下载地址逐字使用对应资产的 `browser_download_url`，不拼接或改写 URL。

只根据真实资产的 `name` 和发布元数据判断系统、架构与文件类型。没有匹配资产时，明确说明最新版未提供所需资产，不从构建脚本推断公开支持范围。

校验值仅在同一发布响应的资产 `digest` 字段，或同一发布中的真实校验文件明确提供时使用。未提供时说明「该发布未提供可核对的公开校验值」，不得猜测 SHA-256。

以下任一情况都视为无法在线核验：

- 无网络或 GitHub API 不可访问
- API 返回无效数据
- 返回项是 draft 或 prerelease
- `assets` 缺失，或没有匹配的安装资产

无法在线核验时，只返回发布页面 `https://github.com/liuzhuang/shell-manage/releases`。不得返回猜测的版本、资产 URL、SHA、架构或文件名，也不得改用源码版本作为公开版本。

## 安装最新正式版本

在线核验成功后：

1. 按设备架构从 API 返回的真实资产中选择 DMG。
2. 使用资产的 `browser_download_url` 下载，不使用推测路径。
3. 发布数据提供校验值时先核对；未提供时明确说明该限制。
4. 挂载 DMG，将 `ShellManage.app` 拖入 `Applications`。
5. 启动应用并完成安装后检查。

仓库文档不替代 macOS 的安全提示。启动被系统拦截时，记录原始提示并核对该正式 Release 的说明，不预设签名或公证状态，也不默认建议绕过系统保护。

## 安装后检查

至少检查：

- 应用能够启动并显示主界面。
- 侧栏底部显示的版本与已核验 Release 的 `tag_name` 一致。
- 「命令」页能够显示现有命令或导入演示命令。
- 「设置」页能够读取配置，状态显示为有效。
- 配置文件位于 `~/.shell-manage/config.yaml`，或 `SHELL_MANAGE_HOME` 指定目录下的 `.shell-manage/config.yaml`。

## 升级

1. 从应用界面读取当前版本。
2. 按「查询规则」核验最新正式 Release。
3. 只有目标 `tag_name` 确认为更高版本时，才备份配置并继续。
4. 使用该 Release 返回的真实资产升级。
5. 重启后检查版本、命令、设置和至少一个已有运行任务。

不得从 `package.json` 或本地构建产物判断是否存在公开更新。

## 自动更新

macOS 客户端包含 Sparkle 更新桥接，更新源指向 GitHub Releases 中的 appcast。自动更新是否可用，以最新正式 Release 是否实际提供匹配架构的 appcast、更新资产及所需签名数据为准；仅看到源码配置不能证明公开更新可用。

自动检查失败时，按「查询规则」核验最新正式 Release；无法在线核验时只返回发布页面，不推断目标版本或下载地址。

## 回滚

自动查询只读取最新正式 Release，不自动推断历史版本或历史资产。需要回滚时：

1. 备份当前配置并完全退出应用。
2. 打开发布页面，由使用者选择明确的历史正式 Release。
3. 未取得该 Release 的真实资产与校验信息前，不提供具体下载 URL。
4. 安装已确认的历史产物后，检查配置结构和关键命令。

没有历史正式 Release 或真实资产时，不把本地构建产物描述成已发布版本。

## 从源码构建本地 DMG

只有在明确请求源码构建且已有仓库副本时，才执行：

```bash
npm install
npm run build:installer:mac
npm run verify:installer:mac
```

本地构建结果只用于本机验证，不是公开版本，不得据此回答「最新版」或生成公开下载地址。
构建和校验脚本都从仓库根目录的 `release/` 读取 DMG 产物；不得把 `dist/` 或其他目录猜作安装包输出目录。

## Skill 返回格式

安装类回答使用 [runtime-protocols.md](runtime-protocols.md) 中的标准字段。无法在线核验时：

- `阶段` 使用 `install`、`upgrade` 或 `troubleshoot`
- `write_status` 使用 `not_written`
- 「下一步」只提供 GitHub Releases 页面
- 「成功判定」说明已在该页面确认正式 Release 和真实资产
- 「回滚」说明本轮没有执行安装或配置写入
