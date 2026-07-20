# ShellManage Assistant 示例

## 示例 1：询问公开下载地址

输入：`ShellManage 从哪里下载？`

当前预期：

- 读取 `distribution-manifest.yaml`
- 识别 `example.com`、占位版本和占位 SHA-256
- 不返回模板 URL
- 说明需要真实发布地址、版本和校验值
- 返回 `write_status: not_written`

## 示例 2：从源码生成本地安装包

输入：`已经有仓库源码，需要在本机生成 DMG。`

预期步骤：

1. 确认依赖已安装。
2. 执行 `npm run build:installer:mac`。
3. 执行 `npm run verify:installer:mac` 检查生成的 DMG。
4. 明确 `release/` 中的本地产物不是公开发布记录。

## 示例 3：接入项目中的命令

输入：`把这个 Next.js 项目接入 ShellManage。`

预期步骤：

1. 读取 `package.json` 中的 scripts。
2. 生成候选命令，例如 `cd /abs/path && npm run dev`。
3. 使用有时间边界的方式检查启动命令。
4. 展示最小配置差异并请求确认。
5. 写入后报告新增命令名和回滚方式。

## 示例 4：启动失败排查

输入：`命令卡片启动后立即失败。`

预期步骤：

1. 核对命令使用的项目目录和入口脚本。
2. 核对 `service` 与 `terminal` 模式。
3. 查看对应命令的实时日志和退出状态。
4. 只在原因明确后提出配置修改。
