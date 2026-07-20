import test from 'node:test'
import assert from 'node:assert/strict'
import { convertScriptToTemplate } from './script-to-template'

const SAMPLE_SCRIPT = `cd example-app

echo "开始备份服务器文件"
ssh -i /Users/alice/.ssh/production.pem root@203.0.113.10 "cp -r /var/www/example-app/dist /var/www/example-app/dist_$(date +%Y%m%d%H%M)"

echo "开始上传压缩包到服务器"
scp -i /Users/alice/.ssh/production.pem /Users/alice/projects/example-app/dist.tar.gz root@203.0.113.10:/var/www/example-app/`

test('convertScriptToTemplate uses project and key display names when config matches', () => {
  const projectPath = '/Users/alice/projects/example-app'
  const keyPath = '/Users/alice/.ssh/production.pem'

  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [{ id: 'proj-1', name: 'example-app', path: projectPath }],
    sshKeys: [{ id: 'production', path: keyPath, label: '生产环境' }]
  })

  assert.match(result.content, /cd \{\{example-app\}\}/)
  assert.match(result.content, /-i \{\{生产环境\}\}/)
  assert.match(result.content, /\{\{example-app\}\}dist\.tar\.gz/)
  assert.match(result.content, /root@203\.0\.113\.10/)
  assert.match(result.content, /\/var\/www\/example-app/)
  assert.doesNotMatch(result.content, /\{\{deployTarget\}\}/)
  assert.doesNotMatch(result.content, /\{\{sshKeyPath\}\}/)
  assert.equal(result.sshKeyRef, 'production')
  assert.equal(result.matchedProjectId, 'proj-1')
})

test('convertScriptToTemplate keeps original script when nothing matches config', () => {
  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [],
    sshKeys: []
  })

  assert.equal(result.content, SAMPLE_SCRIPT)
  assert.deepEqual(result.replacements, [])
})

test('convertScriptToTemplate can replace key by basename/id heuristic', () => {
  const result = convertScriptToTemplate({
    script: SAMPLE_SCRIPT,
    projectDirectories: [],
    sshKeys: [{ id: 'production', path: '/Users/alice/.shell-manage/keys/production.pem', label: '生产环境' }]
  })

  assert.match(result.content, /\{\{生产环境\}\}/)
})

test('convertScriptToTemplate replaces SSH_KEY assignment with key label slot', () => {
  const keyPath = '/Users/alice/.ssh/production.pem'
  const script = `SSH_KEY="${keyPath}"\nscp -i "$SSH_KEY" /tmp/a root@1.2.3.4:/tmp/a`

  const result = convertScriptToTemplate({
    script,
    projectDirectories: [],
    sshKeys: [{ id: 'production', path: keyPath, label: '生产环境' }]
  })

  assert.match(result.content, /SSH_KEY="\{\{生产环境\}\}"/)
  assert.ok(result.content.includes('scp -i "$SSH_KEY"'))
  assert.equal(result.sshKeyRef, 'production')
})

test('convertScriptToTemplate replaces quoted project directory names', () => {
  const script = `declare -A PROJECTS_PATH=(\n    ["1"]="platform"\n    ["2"]="platform"\n)\ncd platform`

  const result = convertScriptToTemplate({
    script,
    projectDirectories: [{ id: 'proj-example', name: 'platform', path: '/Users/alice/projects/platform' }],
    sshKeys: []
  })

  assert.match(result.content, /\["1"\]="\{\{platform\}\}"/)
  assert.match(result.content, /cd \{\{platform\}\}/)
  assert.equal(result.matchedProjectId, 'proj-example')
})
