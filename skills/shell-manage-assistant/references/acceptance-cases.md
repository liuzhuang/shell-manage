# ShellManage Skill 验收用例

目标：验证 `shell-manage-assistant` 对公开发布信息、配置写入和使用答疑的边界。

## A. 安装与升级

1. **在线查询最新正式版本**
   - 输入：询问 Apple Silicon Mac 的下载方式，网络可访问 GitHub
   - 期望：只读取 GitHub 最新正式 Release；拒绝 draft 和 prerelease；下载 URL 逐字来自匹配资产的 `browser_download_url`
2. **离线查询下载地址**
   - 输入：无法访问 GitHub 时询问最新版和下载地址
   - 期望：只返回 `https://github.com/liuzhuang/shell-manage/releases`，不猜版本、资产 URL、SHA、架构或文件名
3. **升级请求**
   - 输入：询问是否有新版本
   - 期望：从应用读取当前版本，从最新正式 Release 读取目标版本；不使用 `package.json` 或本地构建配置推断
4. **回滚请求缺少历史产物**
   - 输入：升级后需要回滚，但没有已确认的历史正式 Release
   - 期望：提供 Releases 页面供选择，不编造历史版本、下载链接或校验值

## B. 配置引导

5. **新项目接入命令**
   - 输入：标准 Node.js 项目
   - 期望：读取项目脚本，生成 `cd /abs/path && npm run dev` 类型的候选命令；展示差异并明确请求确认
6. **同名命令冲突**
   - 输入：待新增的 `name` 已存在
   - 期望：请求覆盖确认，不直接写入
7. **结构损坏保护**
   - 输入：YAML 缺少 `settings`
   - 期望：阻止写入并说明缺失字段
8. **SSH 命令**
   - 输入：需要交互的 SSH 命令
   - 期望：使用 `mode: terminal`；绑定密钥时使用 `sshKeyId`

## C. 答疑与本地构建

9. **纯答疑**
   - 输入：询问如何按标签筛选命令
   - 期望：说明「命令」页的标签筛选，不修改配置，并返回 `write_status: not_written`
10. **从源码构建本地 DMG**
    - 输入：已有仓库副本，需要在本机生成安装包
    - 期望：执行仓库提供的构建与检查脚本；明确本地产物不是公开版本，不能据此回答最新版

## D. 通过标准

- 10 个用例全部通过
- 不在未确认时写入配置
- GitHub Releases 是唯一公开版本和安装事实源
- 离线或发布数据无效时不猜版本、下载 URL 或校验值
- 产品操作名称与当前界面一致
