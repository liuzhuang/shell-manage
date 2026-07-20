import { useEffect, useRef } from 'react'
import {
  getCaretOffset,
  getPlainTextFromEditable,
  highlightTemplateHtml,
  setCaretOffset
} from '../lib/template-slot-html'

export function TemplateSlotEditor(props: {
  value: string
  onChange: (value: string) => void
  knownSlots: string[]
  className?: string
  testId?: string
}) {
  const { value, onChange, knownSlots, className, testId } = props
  const editorRef = useRef<HTMLDivElement>(null)
  const rafRef = useRef<number | null>(null)
  const lastRenderedRef = useRef('')

  function renderEditor(text: string, preserveCaret: boolean) {
    const editor = editorRef.current
    if (!editor) return
    const caret = preserveCaret && document.activeElement === editor ? getCaretOffset(editor) : null
    editor.innerHTML = highlightTemplateHtml(text, knownSlots)
    lastRenderedRef.current = text
    if (preserveCaret) setCaretOffset(editor, caret)
  }

  useEffect(() => {
    if (value === lastRenderedRef.current) return
    renderEditor(value, false)
  }, [value, knownSlots])

  function scheduleRefresh(preserveCaret: boolean) {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const editor = editorRef.current
      if (!editor) return
      const text = getPlainTextFromEditable(editor)
      renderEditor(text, preserveCaret)
      if (text !== value) onChange(text)
    })
  }

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  return (
    <div
      ref={editorRef}
      data-testid={testId}
      className={className}
      contentEditable
      spellCheck={false}
      suppressContentEditableWarning
      onInput={() => scheduleRefresh(true)}
      onPaste={(event) => {
        event.preventDefault()
        const text = event.clipboardData.getData('text/plain')
        const sel = window.getSelection()
        if (!sel || !sel.rangeCount) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        range.insertNode(document.createTextNode(text))
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)
        scheduleRefresh(true)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        const sel = window.getSelection()
        if (!sel || !sel.rangeCount) return
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const nl = document.createTextNode('\n')
        range.insertNode(nl)
        range.setStartAfter(nl)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
        scheduleRefresh(true)
      }}
    />
  )
}
