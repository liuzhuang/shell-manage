export type RectSnapshot = { left: number; top: number; width: number; height: number }

export type CanvasGenieOptions = {
  sourceElement: HTMLElement
  fromRect: RectSnapshot
  toRect: RectSnapshot
  stripCount?: number
  durationMs?: number
  staggerMs?: number
  overlayRoot: HTMLElement
}

const DEFAULT_STRIP_COUNT = 12
const DEFAULT_DURATION_MS = 380
const DEFAULT_STAGGER_MS = 90

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min
  if (value > max) return max
  return value
}

function lerp(start: number, end: number, progress: number): number {
  return start + (end - start) * progress
}

function easeInOutCubic(progress: number): number {
  if (progress < 0.5) return 4 * progress * progress * progress
  const t = -2 * progress + 2
  return 1 - (t * t * t) / 2
}

function copyVisualStyles(from: Element, to: Element): void {
  if (!(from instanceof HTMLElement) || !(to instanceof HTMLElement)) return
  const computed = getComputedStyle(from)
  const style = to.style
  style.backgroundColor = computed.backgroundColor
  style.background = computed.background
  style.color = computed.color
  style.border = computed.border
  style.borderRadius = computed.borderRadius
  style.boxShadow = computed.boxShadow
  style.font = computed.font
  style.fontSize = computed.fontSize
  style.fontWeight = computed.fontWeight
  style.fontFamily = computed.fontFamily
  style.lineHeight = computed.lineHeight
  style.padding = computed.padding
  style.margin = computed.margin
  style.display = computed.display
  style.flexDirection = computed.flexDirection
  style.gap = computed.gap
  style.alignItems = computed.alignItems
  style.justifyContent = computed.justifyContent
  style.overflow = 'hidden'
  style.width = `${from.clientWidth}px`
  style.height = `${from.clientHeight}px`

  const fromChildren = from.children
  const toChildren = to.children
  const count = Math.min(fromChildren.length, toChildren.length)
  for (let index = 0; index < count; index += 1) {
    copyVisualStyles(fromChildren[index], toChildren[index])
  }
}

async function snapshotElementViaSvg(element: HTMLElement, width: number, height: number): Promise<HTMLCanvasElement | null> {
  const clone = element.cloneNode(true) as HTMLElement
  copyVisualStyles(element, clone)
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml')
  clone.style.width = `${width}px`
  clone.style.height = `${height}px`

  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <foreignObject width="100%" height="100%">
    ${serialized}
  </foreignObject>
</svg>`

  return new Promise((resolve) => {
    const image = new Image()
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        resolve(null)
        return
      }
      ctx.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    image.src = url
  })
}

function drawFallbackPanel(ctx: CanvasRenderingContext2D, element: HTMLElement, width: number, height: number): void {
  const panelStyle = getComputedStyle(element.querySelector('[class*="panel"], div > div') || element)
  ctx.fillStyle = panelStyle.backgroundColor || '#2a2a2a'
  ctx.fillRect(0, 0, width, height)
  ctx.strokeStyle = '#3a3a3a'
  ctx.lineWidth = 1
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)

  const titleNode = element.querySelector('[data-testid="log-page"] div[style*="font-weight: 700"], [data-testid="terminal-page"] div[style*="font-weight: 700"]')
  const title = titleNode?.textContent?.trim() || element.textContent?.trim().slice(0, 40) || ''
  if (title) {
    ctx.fillStyle = '#f0f0f0'
    ctx.font = '700 14px -apple-system, system-ui, sans-serif'
    ctx.fillText(title.slice(0, 48), 14, 52)
  }

  const logLines = element.querySelector('[data-testid="log-lines"]')
  if (logLines) {
    ctx.fillStyle = '#151515'
    ctx.fillRect(14, 92, width - 28, Math.max(40, height - 106))
    ctx.fillStyle = '#8a8a8a'
    ctx.font = '11px Menlo, monospace'
    const lines = logLines.textContent?.split('\n').filter(Boolean).slice(0, 8) || []
    lines.forEach((line, index) => ctx.fillText(line.slice(0, 120), 22, 112 + index * 16))
  }
}

async function buildSourceBitmap(sourceElement: HTMLElement, width: number, height: number): Promise<HTMLCanvasElement> {
  const safeWidth = Math.max(1, Math.ceil(width))
  const safeHeight = Math.max(1, Math.ceil(height))
  const snapshot = await snapshotElementViaSvg(sourceElement, safeWidth, safeHeight)
  if (snapshot) return snapshot

  const fallback = document.createElement('canvas')
  fallback.width = safeWidth
  fallback.height = safeHeight
  const ctx = fallback.getContext('2d')
  if (ctx) drawFallbackPanel(ctx, sourceElement, safeWidth, safeHeight)
  return fallback
}

export async function runCanvasGenieMinimizeAnimation(options: CanvasGenieOptions): Promise<void> {
  const {
    sourceElement,
    fromRect,
    toRect,
    overlayRoot,
    stripCount = DEFAULT_STRIP_COUNT,
    durationMs = DEFAULT_DURATION_MS,
    staggerMs = DEFAULT_STAGGER_MS
  } = options

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const canvas = document.createElement('canvas')
  canvas.className = 'genie-canvas'
  canvas.width = viewportWidth
  canvas.height = viewportHeight
  canvas.style.width = `${viewportWidth}px`
  canvas.style.height = `${viewportHeight}px`
  overlayRoot.appendChild(canvas)

  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const sourceBitmap = await buildSourceBitmap(sourceElement, fromRect.width, fromRect.height)
  sourceElement.style.visibility = 'hidden'
  const stripHeight = fromRect.height / stripCount
  const targetCenterX = toRect.left + toRect.width * 0.35
  const targetCenterY = toRect.top + toRect.height / 2

  await new Promise<void>((resolve) => {
    let rafId = 0
    const start = performance.now()

    const tick = (now: number) => {
      const linear = clamp((now - start) / durationMs, 0, 1)
      const eased = easeInOutCubic(linear)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (let index = 0; index < stripCount; index += 1) {
        const centerRatio = stripCount <= 1 ? 0 : index / (stripCount - 1)
        const delayRatio = centerRatio * (staggerMs / durationMs)
        const local = easeInOutCubic(clamp((eased - delayRatio) / (1 - delayRatio), 0, 1))

        const srcY = stripHeight * index
        const stripCenterY = fromRect.top + stripHeight * (index + 0.5)
        const destCenterY = lerp(stripCenterY, targetCenterY, local)

        const left = lerp(fromRect.left, targetCenterX, Math.pow(local, 0.68))
        const right = lerp(fromRect.left + fromRect.width, targetCenterX + toRect.width * 0.55, Math.pow(local, 1.28))
        const width = Math.max(2, right - left)
        const height = Math.max(1.5, stripHeight * lerp(1, 0.55, local))

        ctx.globalAlpha = lerp(0.96, 0.08, local)
        ctx.drawImage(sourceBitmap, 0, srcY, sourceBitmap.width, stripHeight, left, destCenterY - height / 2, width, height)
      }

      ctx.globalAlpha = 1
      if (linear < 1) {
        rafId = window.requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }

    rafId = window.requestAnimationFrame(tick)
  })
}

export function createGenieOverlayRoot(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.setAttribute('data-testid', 'dock-minimize-overlay')
  overlay.className = 'genie-overlay'
  overlay.style.position = 'fixed'
  overlay.style.inset = '0'
  overlay.style.pointerEvents = 'none'
  overlay.style.zIndex = '1600'
  return overlay
}
