import { useEffect, useRef } from 'react'
import yaml from 'js-yaml'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

export function YamlEditor({
  value,
  onChange,
  onSaveShortcut,
  locateLine,
  onLocated
}: {
  value: string
  onChange: (value: string) => void
  onSaveShortcut?: () => void
  locateLine?: number
  onLocated?: () => void
}) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveShortcutRef = useRef(onSaveShortcut)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSaveShortcutRef.current = onSaveShortcut
  }, [onSaveShortcut])

  useEffect(() => {
    if (!holderRef.current || viewRef.current) return
    // 与 @lezer/yaml 的 styleTags 对齐，配色参考 VS Code Dark+ / Light+（变量见 index.css）
    const yamlHighlight = HighlightStyle.define([
      { tag: tags.lineComment, color: 'var(--cm-yaml-comment)', fontStyle: 'italic' },
      { tag: tags.blockComment, color: 'var(--cm-yaml-comment)', fontStyle: 'italic' },
      { tag: tags.string, color: 'var(--cm-yaml-string)' },
      { tag: tags.special(tags.string), color: 'var(--cm-yaml-string)' },
      { tag: tags.content, color: 'var(--cm-yaml-plain)' },
      { tag: tags.definition(tags.propertyName), color: 'var(--cm-yaml-key)' },
      { tag: tags.propertyName, color: 'var(--cm-yaml-key)' },
      { tag: tags.labelName, color: 'var(--cm-yaml-anchor)' },
      { tag: tags.typeName, color: 'var(--cm-yaml-tag)' },
      { tag: tags.keyword, color: 'var(--cm-yaml-bool)' },
      { tag: tags.atom, color: 'var(--cm-yaml-bool)' },
      { tag: tags.bool, color: 'var(--cm-yaml-bool)' },
      { tag: tags.null, color: 'var(--cm-yaml-bool)' },
      { tag: tags.number, color: 'var(--cm-yaml-number)' },
      { tag: tags.attributeValue, color: 'var(--cm-yaml-directive)' },
      { tag: tags.meta, color: 'var(--cm-yaml-meta)' },
      { tag: tags.separator, color: 'var(--cm-yaml-punct)' },
      { tag: tags.punctuation, color: 'var(--cm-yaml-punct)' },
      { tag: tags.squareBracket, color: 'var(--cm-yaml-bracket)' },
      { tag: tags.brace, color: 'var(--cm-yaml-bracket)' }
    ])

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        yamlLang(),
        syntaxHighlighting(yamlHighlight),
        lintGutter(),
        linter((view) => {
          try {
            yaml.load(view.state.doc.toString())
            return []
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            return [{ from: 0, to: Math.min(1, view.state.doc.length), severity: 'error', message }]
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            flex: 1,
            overflow: 'auto',
            fontFamily: 'var(--font-mono), "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
            fontSize: '13px',
            lineHeight: '1.55',
            backgroundColor: 'var(--panel-soft)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-default)'
          },
          '&.cm-focused': { borderColor: 'var(--border-strong)' },
          '.cm-content': { padding: '8px 0', color: 'var(--cm-yaml-fg)', caretColor: 'var(--accent)' },
          '.cm-gutters': {
            backgroundColor: 'var(--cm-yaml-gutter-bg)',
            color: 'var(--cm-yaml-gutter-fg)',
            border: 'none',
            borderRight: '1px solid var(--border-subtle)'
          },
          '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 6px', minWidth: '2.2ch' },
          '.cm-cursor': { borderLeftWidth: '2px', borderLeftColor: 'var(--accent)' },
          '.cm-selectionBackground': { backgroundColor: 'var(--bg-active)' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--accent) 10%, transparent)' },
          '.cm-activeLineGutter': { backgroundColor: 'var(--cm-yaml-gutter-bg)' }
        }),
        keymap.of([
          {
            key: 'Mod-s',
            run: () => {
              onSaveShortcutRef.current?.()
              return true
            }
          }
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        })
      ]
    })
    viewRef.current = new EditorView({ parent: holderRef.current, state })
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
  }, [value])

  useEffect(() => {
    if (!locateLine || !viewRef.current) return
    const view = viewRef.current
    const line = view.state.doc.line(Math.min(Math.max(locateLine, 1), view.state.doc.lines))
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    })
    onLocated?.()
  }, [locateLine, onLocated])

  return <div data-testid="yaml-editor" ref={holderRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} />
}
