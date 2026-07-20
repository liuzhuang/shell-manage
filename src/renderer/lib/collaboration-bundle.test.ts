import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { AppConfig } from '../../shared/types'
import {
  buildCollaborationExportDraft,
  buildCollaborationImportDraft,
  buildCollaborationShareFromExportDraft,
  mergeCollaborationImportIntoConfig,
  parseCollaborationShare,
  serializeCollaborationShare,
  validateCollaborationExportDraft,
  validateCollaborationImportDraft
} from './collaboration-bundle'

function baseConfig(): AppConfig {
  return {
    commands: [],
    presets: [],
    projectDirectories: [{ id: 'p1', name: 'frontend', path: '/tmp/frontend' }],
    deployScripts: [{ id: 's1', name: '部署前端', content: 'cd {{frontend}}' }],
    settings: {
      llm: { provider: 'openai', endpoint: '', apiKey: '', model: '' },
      logBufferLines: 1000
    }
  }
}

describe('collaboration-bundle', () => {
  it('build and parse yaml roundtrip without paths', () => {
    const share = buildCollaborationShareFromExportDraft(
      buildCollaborationExportDraft({
        projectDirectories: [{ id: 'p1', name: 'frontend', path: '/secret/path' }],
        deployScripts: [{ id: 's1', name: '部署', content: 'cd {{frontend}}' }]
      })
    )
    const text = serializeCollaborationShare(share)
    assert.doesNotMatch(text, /\/secret\/path/)
    assert.match(text, /projectDirectories:/)
    assert.match(text, /deployScripts:/)
    const parsed = parseCollaborationShare(text)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.share.projectDirectories?.some((item) => item.name === 'frontend'), true)
    assert.equal(parsed.share.deployScripts?.length, 1)
  })

  it('merge adds project path and script', () => {
    const config = baseConfig()
    config.deployScripts = []
    const share = buildCollaborationShareFromExportDraft(
      buildCollaborationExportDraft({
        projectDirectories: [],
        deployScripts: [{ id: 'x', name: '新脚本', content: 'echo {{frontend}}' }]
      })
    )
    const draft = buildCollaborationImportDraft(config, share)
    draft.scripts[0].selected = true
    const validation = validateCollaborationImportDraft(config, draft)
    assert.equal(validation.ok, true)
    const result = mergeCollaborationImportIntoConfig(config, draft)
    assert.equal(result.scriptsAdded, 1)
    assert.equal(config.deployScripts?.length, 1)
  })

  it('export draft only includes selected rows', () => {
    const draft = buildCollaborationExportDraft({
      projectDirectories: [
        { id: 'p1', name: 'frontend', path: '/a' },
        { id: 'p2', name: 'backend', path: '/b' }
      ],
      deployScripts: [
        { id: 's1', name: '部署前端', content: 'cd {{frontend}}' },
        { id: 's2', name: '部署后端', content: 'cd {{backend}}' }
      ]
    })
    draft.projects.find((row) => row.id === 'p2')!.selected = false
    draft.scripts.find((row) => row.id === 's2')!.selected = false

    const validation = validateCollaborationExportDraft(draft)
    assert.equal(validation.ok, true)

    const share = buildCollaborationShareFromExportDraft(draft)
    assert.equal(share.projectDirectories?.some((item) => item.name === 'frontend'), true)
    assert.equal(share.projectDirectories?.some((item) => item.name === 'backend'), false)
    assert.equal(share.deployScripts?.length, 1)
    assert.equal(share.deployScripts?.[0]?.name, '部署前端')
  })

  it('selected script still exports slot project names', () => {
    const draft = buildCollaborationExportDraft({
      projectDirectories: [{ id: 'p1', name: 'frontend', path: '/a' }],
      deployScripts: [{ id: 's1', name: '部署', content: 'cd {{frontend}}' }]
    })
    draft.projects[0]!.selected = false
    draft.scripts[0]!.selected = true

    const share = buildCollaborationShareFromExportDraft(draft)
    assert.equal(share.deployScripts?.length, 1)
    assert.equal(share.projectDirectories?.some((item) => item.name === 'frontend'), true)
  })

  it('still parses legacy json collaboration bundle', () => {
    const legacy = JSON.stringify({
      kind: 'shell-manage.collaboration',
      version: 1,
      exportedAt: new Date().toISOString(),
      projectNames: ['frontend'],
      scripts: [{ name: '部署', content: 'cd {{frontend}}' }]
    })
    const parsed = parseCollaborationShare(legacy)
    assert.equal(parsed.ok, true)
    if (!parsed.ok) return
    assert.equal(parsed.share.deployScripts?.length, 1)
  })

  it('merge requires path for new project name', () => {
    const config = baseConfig()
    config.projectDirectories = []
    const share = buildCollaborationShareFromExportDraft(
      buildCollaborationExportDraft({
        projectDirectories: [],
        deployScripts: [{ id: 'x', name: '脚本', content: 'cd {{frontend}}' }]
      })
    )
    const draft = buildCollaborationImportDraft(config, share)
    const validation = validateCollaborationImportDraft(config, draft)
    assert.equal(validation.ok, false)
  })
})
