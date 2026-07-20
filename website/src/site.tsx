import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { appIcon, screenshots, type ScreenshotId } from './assets'

const downloadUrl = 'https://github.com/liuzhuang/shell-manage/releases'
const lensWidth = 280
const lensHeight = 180
const lensZoom = 2

interface ScreenshotProps {
  id: ScreenshotId
  priority?: boolean
  testId?: string
}

interface FeatureProps {
  title: string
  description: string
  screenshot: ScreenshotId
}

const terms = [
  ['启动命令', '告诉电脑如何启动项目或建立连接的一行指令。'],
  ['运行日志', '项目运行时持续产生的文字记录，用来查看状态和错误。'],
  ['交互终端', '命令启动后仍可继续输入和查看结果的窗口。'],
  ['SSH 隧道', '通过加密连接，把本机请求转发到远程服务器。'],
  ['SSH 密钥', '用于证明有权连接远程服务器的私钥文件。'],
  ['项目目录', '保存项目代码和配置文件的本机文件夹。']
] as const

function DownloadLink({ compact = false }: { compact?: boolean }): ReactNode {
  return (
    <a
      className={`button${compact ? ' button--compact' : ''}`}
      href={downloadUrl}
      data-testid="download-button"
    >
      下载
    </a>
  )
}

function Screenshot({ id, priority = false, testId }: ScreenshotProps): ReactNode {
  const screenshot = screenshots[id]
  const lensRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)

  const moveLens = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType !== 'mouse' || !lensRef.current) return

    const rect = event.currentTarget.getBoundingClientRect()
    const imageWidth = event.currentTarget.clientWidth
    const imageHeight = event.currentTarget.clientHeight
    const width = Math.min(lensWidth, imageWidth)
    const height = Math.min(lensHeight, imageHeight)
    const x = Math.min(Math.max(event.clientX - rect.left - event.currentTarget.clientLeft, 0), imageWidth)
    const y = Math.min(Math.max(event.clientY - rect.top - event.currentTarget.clientTop, 0), imageHeight)
    const left = Math.min(x, imageWidth - width)
    const top = Math.min(y, imageHeight - height)
    const lens = lensRef.current

    lens.hidden = false
    lens.style.width = `${width}px`
    lens.style.height = `${height}px`
    lens.style.transform = `translate3d(${left}px, ${top}px, 0)`
    lens.style.backgroundImage = `url("${screenshot.src}")`
    lens.style.backgroundSize = `${imageWidth * lensZoom}px ${imageHeight * lensZoom}px`
    lens.style.backgroundPosition = `${-x * lensZoom}px ${-y * lensZoom}px`
  }

  const hideLens = (): void => {
    if (lensRef.current) lensRef.current.hidden = true
  }

  const openDialog = (): void => {
    hideLens()
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal()
  }

  return (
    <>
      <button
        className="product-shot"
        type="button"
        aria-label={`放大查看：${screenshot.alt}`}
        aria-haspopup="dialog"
        data-testid={testId}
        onClick={openDialog}
        onPointerMove={moveLens}
        onPointerLeave={hideLens}
      >
        <img
          src={screenshot.src}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          loading={priority ? 'eager' : 'lazy'}
          fetchPriority={priority ? 'high' : 'auto'}
          decoding="async"
        />
        <span ref={lensRef} className="screenshot-lens" hidden aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className="screenshot-dialog"
        aria-label={`查看大图：${screenshot.alt}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close()
        }}
      >
        <button
          className="screenshot-dialog__close"
          type="button"
          onClick={() => dialogRef.current?.close()}
        >
          关闭
        </button>
        <img
          src={screenshot.src}
          alt={screenshot.alt}
          width={screenshot.width}
          height={screenshot.height}
          decoding="async"
        />
      </dialog>
    </>
  )
}

function Feature({ title, description, screenshot }: FeatureProps): ReactNode {
  return (
    <article className="feature">
      <div className="feature__copy">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      <Screenshot id={screenshot} />
    </article>
  )
}

function SiteHeader(): ReactNode {
  return (
    <>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <header className="site-header" data-testid="site-header">
        <div className="site-header__inner">
          <a className="brand" href="/" aria-label="ShellManage 首页">
            <img src={appIcon} alt="" width="34" height="34" />
            <span>ShellManage</span>
          </a>
          <nav className="site-nav" aria-label="主要导航">
            <a href="#features">功能</a>
            <a href="#getting-started">上手</a>
            <a href="#terms">术语</a>
          </nav>
          <DownloadLink compact />
        </div>
      </header>
    </>
  )
}

function GettingStarted(): ReactNode {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const guideUrl = new URL('/doc/shell-manage-assistant.md', window.location.origin).href
  const importInstruction =
    `请阅读 ${guideUrl}，按照文档分析当前项目，并将验证通过的启动命令导入 ShellManage。`

  const copyImportInstruction = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(importInstruction)
      setCopyStatus('copied')
    } catch {
      setCopyStatus('error')
    }
  }

  return (
    <section className="skill-section" id="getting-started" data-testid="getting-started">
      <div className="section-heading">
        <p className="eyebrow">三步上手</p>
        <h2>安装 ShellManage，然后让 AI 导入命令。</h2>
        <p>
          软件安装完成后，把导入指令发送给当前项目中的 Agent。命令写入配置后即可回到 ShellManage 启动。
        </p>
      </div>
      <div className="onboarding-steps">
        <article className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>01</span>
            <h3>下载并安装</h3>
          </div>
          <p>下载 macOS 版本，将 ShellManage 安装到应用程序目录。</p>
          <div className="onboarding-step__actions">
            <DownloadLink />
            <a href="/doc/install/" data-testid="install-guide-link">查看安装说明</a>
          </div>
        </article>
        <article className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>02</span>
            <h3>发送导入指令</h3>
          </div>
          <p>在当前项目的 Agent 对话窗口发送下面这句话。</p>
          <div className="import-instruction" data-testid="import-instruction">
            {importInstruction}
          </div>
          <button
            className="button"
            type="button"
            data-testid="import-instruction-copy"
            onClick={() => void copyImportInstruction()}
          >
            {copyStatus === 'copied' ? '已复制，请发送给 Agent' : '复制导入指令'}
          </button>
          <a
            className="onboarding-step__guide-link"
            href="/doc/shell-manage-assistant/"
            data-testid="assistant-guide-link"
          >
            查看导入说明
          </a>
          <p className="copy-status" role="status" aria-live="polite">
            {copyStatus === 'error' ? '复制失败，请手动选择并复制导入指令。' : ''}
          </p>
        </article>
        <article className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>03</span>
            <h3>启动新命令</h3>
          </div>
          <p>回到 ShellManage，找到新命令并启动。看到实时日志后，首次上手即完成。</p>
        </article>
      </div>
    </section>
  )
}

function Hero(): ReactNode {
  return (
    <section className="hero" data-testid="hero">
      <div className="hero__copy">
        <p className="eyebrow">为 Vibe Coding 构建者准备的 macOS 应用</p>
        <h1>不用记命令，也不用重复输入。</h1>
        <p className="hero__lead">
          保存项目启动命令、SSH 隧道和其他重复操作，需要时直接运行，并在同一处查看状态和日志。
        </p>
        <DownloadLink />
      </div>
      <div className="hero__visual">
        <Screenshot id="command-home" priority testId="hero-screenshot" />
        <p>每个项目的启动方式只需保存一次，以后直接点击启动。</p>
      </div>
    </section>
  )
}

function CoreWorkflow(): ReactNode {
  return (
    <section className="section" id="features" data-testid="core-workflow">
      <div className="section-heading">
        <p className="eyebrow">核心工作流</p>
        <h2>把每天要开的项目放在同一页。</h2>
      </div>
      <Feature
        title="运行日志"
        description="项目启动后，实时查看运行状态、输出和错误；停止或断开后可以再次启动。"
        screenshot="running-log"
      />
    </section>
  )
}

function DevelopmentWorkspace(): ReactNode {
  return (
    <section className="section section--tinted" data-testid="development-workspace">
      <div className="section-heading">
        <p className="eyebrow">开发现场</p>
        <h2>项目启动后，不必再切换多个工具。</h2>
      </div>
      <Feature
        title="内置浏览器"
        description="在应用内打开本地项目和常用网页，保持独立的浏览会话。"
        screenshot="browser"
      />
      <Feature
        title="运行监控"
        description="查看这台电脑或远程服务器的 CPU、内存、磁盘和网络状态。"
        screenshot="monitoring"
      />
      <Feature
        title="AI 配置"
        description="接入正在使用的 AI 模型服务。"
        screenshot="ai-settings"
      />
      <Feature
        title="AI 查询"
        description="直接询问服务器状态，由 AI 生成查询命令并返回结果。"
        screenshot="ai-query"
      />
    </section>
  )
}

function RemoteAndTeam(): ReactNode {
  return (
    <section className="section" data-testid="remote-and-team">
      <div className="section-heading">
        <p className="eyebrow">远程与团队</p>
        <h2>远程连接和团队发版，也不必重复配置。</h2>
      </div>
      <Feature
        title="SSH 密钥"
        description="连接远程服务器所需的私钥保存在本机，之后不用反复选择密钥文件。"
        screenshot="ssh-keys"
      />
      <Feature
        title="发版脚本"
        description="把固定的发版步骤保存成脚本，需要时执行，也可以分享给团队。"
        screenshot="collaboration-scripts"
      />
      <Feature
        title="项目目录"
        description="分享时只保留项目名称；同事导入后，选择自己电脑上的项目文件夹。"
        screenshot="collaboration-directories"
      />
    </section>
  )
}

function TermGuide(): ReactNode {
  return (
    <section className="term-section" id="terms" data-testid="term-guide">
      <div className="section-heading">
        <p className="eyebrow">术语速查</p>
        <h2>软件内常见词汇的含义。</h2>
      </div>
      <dl className="term-grid">
        {terms.map(([term, description]) => (
          <div key={term}>
            <dt>{term}</dt>
            <dd>{description}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function DownloadSection(): ReactNode {
  return (
    <section className="download-section" id="download">
      <div>
        <p className="eyebrow">ShellManage for macOS</p>
        <h2>把重复操作留给 ShellManage。</h2>
      </div>
      <DownloadLink />
    </section>
  )
}

function SiteFooter(): ReactNode {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <a className="brand" href="/">
          <img src={appIcon} alt="" width="30" height="30" loading="lazy" />
          <span>ShellManage</span>
        </a>
        <p>保存命令，需要时直接运行。</p>
        <a href="#main-content">返回顶部</a>
      </div>
    </footer>
  )
}

export function HomePage(): ReactNode {
  return (
    <div data-testid="home-page">
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <Hero />
        <CoreWorkflow />
        <GettingStarted />
        <DevelopmentWorkspace />
        <RemoteAndTeam />
        <TermGuide />
        <DownloadSection />
      </main>
      <SiteFooter />
    </div>
  )
}
