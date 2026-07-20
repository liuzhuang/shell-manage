import { useEffect, useMemo, useRef, useState } from 'react'
import yaml from 'js-yaml'
import type { AppConfig } from '../../shared/types'

function resolveDefaultTag(tags: string[]): string {
  return tags.length > 1 ? tags[1]! : '全部'
}

const EMPTY_CONFIG: AppConfig = {
  commands: [],
  presets: [],
  settings: {
    llm: { provider: 'openai', endpoint: '', apiKey: '', model: '' },
    themePreset: 'system',
    launchAtLogin: false,
    logBufferLines: 5000
  }
}

export function useConfigState() {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG)
  const [editorRaw, setEditorRaw] = useState('')
  const [editorError, setEditorError] = useState('')
  const [keyword, setKeyword] = useState('')
  const [activeTag, setActiveTag] = useState('全部')
  const didApplyInitialTag = useRef(false)

  useEffect(() => {
    window.api.configRead().then((raw) => {
      setEditorRaw(raw)
      try {
        setConfig(yaml.load(raw) as AppConfig)
      } catch {
        // ignored, wait for config:loaded event
      }
    })
    const offLoaded = window.api.onConfigLoaded((payload) => setConfig(payload))
    return () => {
      offLoaded?.()
    }
  }, [])

  const tags = useMemo(() => {
    const set = new Set<string>()
    config.commands.forEach((cmd) => cmd.tags.forEach((tag) => set.add(tag)))
    const existing = Array.from(set)
    const configuredOrder = Array.isArray(config.settings.tagOrder) ? config.settings.tagOrder : []
    const ordered = configuredOrder.filter((tag) => set.has(tag))
    const unordered = existing.filter((tag) => !ordered.includes(tag))
    return ['全部', ...ordered, ...unordered]
  }, [config.commands, config.settings.tagOrder])

  useEffect(() => {
    if (didApplyInitialTag.current) return
    if (tags.length > 1) {
      setActiveTag(tags[1]!)
      didApplyInitialTag.current = true
    }
  }, [tags])

  useEffect(() => {
    if (!tags.includes(activeTag)) setActiveTag(resolveDefaultTag(tags))
  }, [tags, activeTag])

  const filteredCommands = useMemo(() => {
    return config.commands.filter((cmd) => {
      const tagMatched = activeTag === '全部' || cmd.tags.includes(activeTag)
      const keywordMatched =
        !keyword ||
        cmd.name.includes(keyword) ||
        cmd.command.includes(keyword) ||
        cmd.tags.some((tag) => tag.includes(keyword))
      return tagMatched && keywordMatched
    })
  }, [activeTag, keyword, config.commands])

  async function saveEditor() {
    const validate = await window.api.configValidate(editorRaw)
    if (!validate.valid) {
      setEditorError(validate.error || '语法错误')
      return { ok: false, error: validate.error || '语法错误' }
    }
    await window.api.configSave(editorRaw)
    setEditorError('')
    return { ok: true }
  }

  return {
    config,
    editorRaw,
    setEditorRaw,
    editorError,
    setEditorError,
    saveEditor,
    keyword,
    setKeyword,
    activeTag,
    setActiveTag,
    tags,
    filteredCommands
  }
}
