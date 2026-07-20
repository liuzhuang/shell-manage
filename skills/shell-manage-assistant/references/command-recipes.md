# 常见命令模板（ShellManage）

以下模板用于 Skill 生成候选命令。默认采用：

`cd <项目绝对路径> && <启动命令>`

例外：交互型远程命令（如 SSH）允许不加 `cd /abs/path &&`，直接执行远程连接命令。

## Node.js / 前端

- Vite/React:
  - `cd /abs/project && npm run dev`
- Next.js:
  - `cd /abs/project && npm run dev`
- pnpm 项目:
  - `cd /abs/project && pnpm dev`

## Python

- FastAPI:
  - `cd /abs/project && uvicorn app.main:app --reload`
- Flask:
  - `cd /abs/project && flask run --debug`

## Go

- 直接运行:
  - `cd /abs/project && go run .`
- Air 热更新:
  - `cd /abs/project && air`

## Java / JVM

- Maven:
  - `cd /abs/project && mvn spring-boot:run`
- Gradle:
  - `cd /abs/project && ./gradlew bootRun`

## 运维 / SSH

- SSH（交互）:
  - `ssh dev@10.0.0.1`
  - `mode: terminal`
  - 如有密钥：补 `sshKeyId`

## 校验建议

写入前至少做一项快速校验：

- `npm run dev -- --help`
- `python -c "import app"`（按项目实际入口调整）
- `go run . --help`（若支持）
- 对长驻命令做短时启动探测
