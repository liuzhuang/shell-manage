import { highlightShellPlainText } from './shell-highlight'

const SLOT_RE = /\{\{\s*([^}]+?)\s*\}\}/g

function normalizeSlotName(raw: string): string {
  return raw.trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function countTemplate(text: string): { chars: number; tokens: number } {
  const chars = text.length
  return { chars, tokens: Math.round(chars / 4.2) }
}

export function highlightTemplateHtml(text: string, knownSlots: string[]): string {
  const known = new Set(knownSlots)
  let html = ''
  let last = 0
  SLOT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SLOT_RE.exec(text)) !== null) {
    html += highlightShellPlainText(text.slice(last, match.index))
    const name = normalizeSlotName(match[1])
    const cls = known.has(name) ? 'slot' : 'slot warn'
    html += `<span class="${cls}">${escapeHtml(match[0])}</span>`
    last = match.index + match[0].length
  }
  html += highlightShellPlainText(text.slice(last))
  return html
}

export function fillTemplatePreviewHtml(template: string, values: Record<string, string | undefined>): string {
  let html = ''
  let last = 0
  SLOT_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SLOT_RE.exec(template)) !== null) {
    html += highlightShellPlainText(template.slice(last, match.index))
    const name = match[1]
    const value = values[name]
    if (value !== undefined && value !== '') {
      html += `<span class="filled sh-path">${escapeHtml(String(value))}</span>`
    } else {
      html += `<span class="missing">${escapeHtml(match[0])}</span>`
    }
    last = match.index + match[0].length
  }
  html += highlightShellPlainText(template.slice(last))
  return html
}

export function getPlainTextFromEditable(root: HTMLElement): string {
  let out = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName
      if (tag === 'BR') out += '\n'
      if (tag === 'DIV' && node !== root.firstChild && out.length && out[out.length - 1] !== '\n') {
        out += '\n'
      }
    }
  }
  return out
}

export function getCaretOffset(root: HTMLElement): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return null

  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)

  const frag = pre.cloneContents()
  let off = 0
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, null)
  let node: Node | null
  let lastChar = ''
  let first = true
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      off += node.nodeValue?.length || 0
      if (node.nodeValue && node.nodeValue.length) lastChar = node.nodeValue[node.nodeValue.length - 1]
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === 'BR') {
        off += 1
        lastChar = '\n'
      }
      if ((node as Element).tagName === 'DIV' && !first && lastChar !== '\n') {
        off += 1
        lastChar = '\n'
      }
    }
    first = false
  }
  return off
}

export function setCaretOffset(root: HTMLElement, offset: number | null): void {
  if (offset == null) return
  const sel = window.getSelection()
  if (!sel) return

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let node: Node | null
  let remaining = offset
  let lastNode: Node | null = null

  while ((node = walker.nextNode())) {
    lastNode = node
    const len = node.nodeValue?.length || 0
    if (remaining <= len) {
      const range = document.createRange()
      range.setStart(node, remaining)
      range.collapse(true)
      sel.removeAllRanges()
      sel.addRange(range)
      return
    }
    remaining -= len
  }

  const range = document.createRange()
  if (lastNode && lastNode.nodeValue) {
    range.setStart(lastNode, lastNode.nodeValue.length)
  } else {
    range.selectNodeContents(root)
    range.collapse(false)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}
