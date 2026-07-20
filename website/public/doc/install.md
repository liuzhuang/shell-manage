# 下载并安装 ShellManage

本文档供 Agent 读取。目标是指导使用者下载并安装 ShellManage 应用，不负责导入项目命令。

## 1. 确认运行环境

ShellManage 当前面向 macOS。先确认 Mac 的芯片架构，再从发布页面选择匹配的 DMG：

```text
https://github.com/liuzhuang/shell-manage/releases
```

不要把本地构建、占位清单或未核验文件描述为公开版本。

## 2. 安装应用

1. 打开已下载的 DMG。
2. 将 `ShellManage.app` 拖入「应用程序」目录。
3. 从「应用程序」启动 ShellManage。
4. 遇到系统安全提示时，先核对发布记录和实际提示，不默认绕过 macOS 保护。

## 3. 完成初始化

首次启动后，确认以下配置文件已经创建：

```text
~/.shell-manage/config.yaml
```

配置文件存在表示应用已经完成初始化。下一步可以读取：

```text
/doc/shell-manage-assistant.md
```

并按照其中的规则导入项目启动命令。
