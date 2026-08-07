import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { appIcon, screenshots, type ScreenshotId } from './assets'
import copyIcon from './images/copy-icon.png'

const downloadUrl = 'https://github.com/liuzhuang/shell-manage/releases'
const githubUrl = 'https://github.com/liuzhuang/shell-manage'
const lensWidth = 280
const lensHeight = 180
const lensZoom = 2
const lensPointerOffset = 48

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
  ['启动命令', '告诉电脑怎样启动项目或建立远程连接的一行指令。'],
  ['运行日志', '项目运行时不断出现的文字记录，用来查看当前状态和错误。'],
  ['交互终端', '命令启动后，还能继续输入内容并查看结果的窗口。'],
  ['SSH 隧道', '通过加密连接，把本机的访问请求转发到远程服务器。'],
  ['SSH 密钥', '连接远程服务器时，用来证明访问权限的私钥文件。'],
  ['项目目录', '这台电脑上保存项目代码和配置文件的文件夹。']
] as const

function DownloadLink(): ReactNode {
  return (
    <a
      className="button"
      href="#getting-started"
      data-testid="download-button"
    >
      查看安装方法
    </a>
  )
}

function Screenshot({ id, priority = false, testId }: ScreenshotProps): ReactNode {
  const screenshot = screenshots[id]
  const lensRef = useRef<HTMLSpanElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const moveLens = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.pointerType !== 'mouse' || !lensRef.current) return

    const rect = event.currentTarget.getBoundingClientRect()
    const imageWidth = event.currentTarget.clientWidth
    const imageHeight = event.currentTarget.clientHeight
    const width = Math.min(lensWidth, imageWidth)
    const height = Math.min(lensHeight, imageHeight)
    const x = Math.min(Math.max(event.clientX - rect.left - event.currentTarget.clientLeft, 0), imageWidth)
    const y = Math.min(Math.max(event.clientY - rect.top - event.currentTarget.clientTop, 0), imageHeight)
    const left = Math.min(Math.max(x - lensPointerOffset, 0), imageWidth - width)
    const top = Math.min(Math.max(y - lensPointerOffset, 0), imageHeight - height)
    const lens = lensRef.current

    lens.hidden = false
    lens.style.width = `${width}px`
    lens.style.height = `${height}px`
    lens.style.transform = `translate3d(${left}px, ${top}px, 0)`
    lens.style.backgroundImage = `url("${screenshot.src}")`
    lens.style.backgroundSize = `${imageWidth * lensZoom}px ${imageHeight * lensZoom}px`
    lens.style.backgroundPosition = `${x - left - x * lensZoom}px ${y - top - y * lensZoom}px`
  }

  const hideLens = (): void => {
    if (lensRef.current) lensRef.current.hidden = true
  }

  const openDialog = (): void => {
    hideLens()
    if (dialogRef.current && !dialogRef.current.open) {
      setIsDialogOpen(true)
      dialogRef.current.showModal()
    }
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
        <picture>
          <source media="(max-width: 640px)" srcSet={screenshot.previewSmall} />
          <img
            src={screenshot.previewLarge}
            alt={screenshot.alt}
            width={screenshot.width}
            height={screenshot.height}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
          />
        </picture>
        <span ref={lensRef} className="screenshot-lens" hidden aria-hidden="true" />
      </button>
      <dialog
        ref={dialogRef}
        className="screenshot-dialog"
        aria-label={`查看大图：${screenshot.alt}`}
        onClose={() => setIsDialogOpen(false)}
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
        {isDialogOpen ? (
          <img
            src={screenshot.src}
            alt={screenshot.alt}
            width={screenshot.width}
            height={screenshot.height}
            decoding="async"
          />
        ) : null}
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
            <a href="#getting-started">安装</a>
            <a href="#terms">术语</a>
          </nav>
          <a
            className="github-link"
            href={githubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 查看 ShellManage"
            data-testid="github-link"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 1C5.923 1 1 5.923 1 12c0 4.867 3.149 8.979 7.521 10.436.55.096.756-.233.756-.522 0-.262-.013-1.128-.013-2.049-2.764.509-3.479-.674-3.699-1.292-.124-.317-.66-1.293-1.127-1.554-.385-.207-.935-.715-.014-.729.866-.014 1.485.797 1.691 1.128.99 1.663 2.571 1.196 3.204.907.096-.715.385-1.196.701-1.471-2.406-.275-4.922-1.196-4.922-5.317 0-1.182.412-2.145 1.127-2.901-.11-.275-.495-1.389.11-2.86 0 0 .921-.288 3.024 1.128A10.193 10.193 0 0 1 12 6.669c.935 0 1.87.123 2.75.371 2.104-1.43 3.025-1.128 3.025-1.128.605 1.471.22 2.585.11 2.86.701.756 1.127 1.719 1.127 2.901 0 4.135-2.53 5.042-4.936 5.317.385.33.729.976.729 1.994 0 1.443-.014 2.599-.014 2.956 0 .289.206.632.77.522A11.027 11.027 0 0 0 23 12C23 5.923 18.077 1 12 1Z" />
            </svg>
          </a>
        </div>
      </header>
    </>
  )
}

function GettingStarted(): ReactNode {
  const [copyStatus, setCopyStatus] = useState<'install' | 'import' | 'install-error' | 'import-error' | null>(null)
  const installGuideUrl = new URL('/doc/install.md', window.location.origin).href
  const guideUrl = new URL('/doc/shell-manage-assistant.md', window.location.origin).href
  const installInstruction = `请阅读 ${installGuideUrl}，并按照文档指导我下载和安装 ShellManage。`
  const importInstruction =
    `请阅读 ${guideUrl}，分析并验证当前项目的启动方式。写入前请展示准备修改的内容，得到确认后再将命令导入 ShellManage。`

  const copyInstruction = async (instruction: string, target: 'install' | 'import'): Promise<void> => {
    try {
      await navigator.clipboard.writeText(instruction)
      setCopyStatus(target)
    } catch {
      setCopyStatus(`${target}-error`)
    }
  }

  return (
    <section className="skill-section" id="getting-started" data-testid="getting-started">
      <div className="section-heading">
        <p className="eyebrow">三步上手</p>
        <h2>安装好 ShellManage，再让 Agent 导入项目。</h2>
        <p>
          复制页面提供的说明并发送给当前项目中的 Agent。Agent 会读取文档、分析项目并验证启动方式；写入前仍需确认。
        </p>
      </div>
      <ol className="onboarding-steps">
        <li className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>01</span>
            <h3>安装 ShellManage</h3>
          </div>
          <p>复制安装说明并发送给 Agent。Agent 会打开安装文档，说明应该下载哪个安装包以及怎样安装；也可以直接手动下载安装。</p>
          <div className="import-instruction" data-testid="install-instruction">
            <span className="import-instruction__content">
              <span>请阅读 ShellManage 安装文档，并按照文档指导我下载和安装 ShellManage。</span>
              <a href={installGuideUrl} target="_blank" rel="noreferrer">{installGuideUrl}</a>
            </span>
            <button
              className="instruction-copy"
              type="button"
              data-testid="install-instruction-copy"
              onClick={() => void copyInstruction(installInstruction, 'install')}
            >
              <img src={copyIcon} alt="" width="16" height="16" aria-hidden="true" />
              {copyStatus === 'install' ? '已复制' : '复制安装说明'}
            </button>
          </div>
          <div className="onboarding-step__actions">
            <a href={downloadUrl} data-testid="download-button">手动下载安装</a>
          </div>
          <p className="copy-status" role="status" aria-live="polite">
            {copyStatus === 'install-error' ? '复制失败，请手动选择并复制安装说明。' : ''}
          </p>
        </li>
        <li className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>02</span>
            <h3>导入项目启动方式</h3>
          </div>
          <p>复制导入说明并发送给当前项目中的 Agent。Agent 会分析项目，找到并验证合适的启动方式。确认准备写入的内容后，再导入 ShellManage。</p>
          <div className="import-instruction" data-testid="import-instruction">
            <span className="import-instruction__content">
              <span>请阅读 ShellManage 导入帮助文档，分析并验证当前项目的启动方式。写入前请展示准备修改的内容，得到确认后再将命令导入 ShellManage。</span>
              <a href={guideUrl} target="_blank" rel="noreferrer">{guideUrl}</a>
            </span>
            <button
              className="instruction-copy"
              type="button"
              data-testid="import-instruction-copy"
              onClick={() => void copyInstruction(importInstruction, 'import')}
            >
              <img src={copyIcon} alt="" width="16" height="16" aria-hidden="true" />
              {copyStatus === 'import' ? '已复制' : '复制导入说明'}
            </button>
          </div>
          <p className="copy-status" role="status" aria-live="polite">
            {copyStatus === 'import-error' ? '复制失败，请手动选择并复制导入说明。' : ''}
          </p>
        </li>
        <li className="onboarding-step">
          <div className="onboarding-step__heading">
            <span>03</span>
            <h3>启动并查看日志</h3>
          </div>
          <p>回到 ShellManage，找到刚添加的项目并点击「启动」。看到运行状态和实时日志后，就完成了第一次使用。</p>
        </li>
      </ol>
    </section>
  )
}

function Hero(): ReactNode {
  return (
    <section className="hero" data-testid="hero">
      <div className="hero__copy">
        <p className="eyebrow">For VibeCoding</p>
        <h1>VibeCoding 项目多，也不用重复敲命令</h1>
        <p className="hero__lead">
          把每个项目的启动命令、SSH 隧道和其他重复操作保存一次。以后打开 ShellManage，点击就能运行，状态和日志也都在同一处。
        </p>
        <DownloadLink />
      </div>
      <div className="hero__visual">
        <Screenshot id="command-home" priority testId="hero-screenshot" />
        <p>常用项目集中在一页，是否正在运行，一眼就能看清。</p>
      </div>
    </section>
  )
}

function CoreWorkflow(): ReactNode {
  return (
    <section className="section" id="features" data-testid="core-workflow">
      <div className="section-heading">
        <p className="eyebrow">核心工作流</p>
        <h2>常开的 VibeCoding 项目，都放在同一页。</h2>
      </div>
      <Feature
        title="运行日志"
        description="项目启动后，运行状态、实时输出和错误会持续显示。项目停止或连接断开后，也可以从这里再次启动。"
        screenshot="running-log"
      />
    </section>
  )
}

function DevelopmentWorkspace(): ReactNode {
  return (
    <section className="section section--tinted" data-testid="development-workspace">
      <div className="section-heading">
        <p className="eyebrow">开发环境</p>
        <h2>启动、浏览、监控和查日志，都可以放在一个应用里。</h2>
      </div>
      <Feature
        title="内置浏览器"
        description="在 ShellManage 中打开本地项目和常用网页，使用与常用浏览器分开的独立会话。"
        screenshot="browser"
      />
      <Feature
        title="运行监控"
        description="查看本机或已连接远程服务器的处理器（CPU）、内存、磁盘和网络状态。"
        screenshot="monitoring"
      />
      <Feature
        title="AI 配置"
        description="接入正在使用的 AI 模型服务，供日志查询和分析使用。"
        screenshot="ai-settings"
      />
      <Feature
        title="AI 查日志"
        description="用一句话描述想查的问题，AI 会在已连接的会话中生成查询命令并分析结果。需要确认的操作不会直接执行。"
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
        <h2>连接服务器、执行发版，也能把常用步骤保存下来。</h2>
      </div>
      <Feature
        title="SSH 密钥"
        description="SSH 密钥是连接远程服务器时使用的私钥文件。保存在本机后，不必每次重新选择。"
        screenshot="ssh-keys"
      />
      <Feature
        title="发版脚本"
        description="把固定的发版步骤保存成脚本，需要时执行，也可以分享给团队。"
        screenshot="collaboration-scripts"
      />
      <Feature
        title="项目目录"
        description="分享协作内容时只保留项目名称，不会带上本机路径。同事导入后，再选择自己电脑上的项目文件夹。"
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
        <h2>这些词在 ShellManage 里分别指什么。</h2>
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
      <h2>把常用项目放进 ShellManage，下次直接启动。</h2>
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
        <p>启动方式只保存一次，需要时直接运行。</p>
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
