import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

const securityGatePath = './security-gate.ts'
const loadSecurityGate = () => import(securityGatePath) as Promise<typeof import('./security-gate')>

test('Agent 判定 safe 时，本地安全门放行查询、串联、敏感路径和持续命令', async () => {
  const { assessCommandForAutoExecution, hardenCommandForAutoExecution } = await loadSecurityGate()
  const safeCommands = [
    'top -b -n 1 | head -20',
    'date && cat ~/.ssh/id_rsa',
    "grep 'error; rm' app.log",
    "grep 'x > y' app.log",
    'kubectl get pods',
    'docker inspect container-name',
    'docker stats --no-stream',
    'systemctl status sshd',
    'custom-observer --status',
    'top',
    'tail -f app.log',
    'watch date',
    'ping example.com',
    'sudo -u root cat /etc/shadow',
    'env LC_ALL=C grep error /var/log/messages',
    'docker image inspect rm',
    'kubectl logs -f pod/example',
    'fdisk -l',
    'parted /dev/sdb print',
    'printf %s foo#bar',
    'kill -0 1234',
    'kill -l',
    "sh -c -- 'date'",
    "ssh example.com \"grep 'error; rm' app.log\"",
    'ssh -o StrictHostKeyChecking=no example.com date',
    'setsid date',
    'chroot /mnt cat /etc/os-release',
    'git -c color.ui=false status',
    'docker compose --file compose.yml ps'
  ]
  for (const command of safeCommands) {
    const assessment = assessCommandForAutoExecution(command, 'safe')
    assert.equal(assessment.riskLevel, 'safe', command)
    assert.equal(assessment.canAutoExecute, true, command)
  }

  assert.equal(
    hardenCommandForAutoExecution("head -n 1 ~/.git-credentials || printf '%s' fallback"),
    "if PATH=/usr/bin:/bin:/usr/sbin:/sbin ENV= BASH_ENV= PS1= LD_PRELOAD= LD_LIBRARY_PATH= LD_AUDIT= DYLD_INSERT_LIBRARIES= DYLD_LIBRARY_PATH= NODE_OPTIONS= PYTHONPATH= PERL5OPT= RUBYOPT= /bin/sh -p -c ':' >/dev/null 2>&1; then PATH=/usr/bin:/bin:/usr/sbin:/sbin ENV= BASH_ENV= PS1= LD_PRELOAD= LD_LIBRARY_PATH= LD_AUDIT= DYLD_INSERT_LIBRARIES= DYLD_LIBRARY_PATH= NODE_OPTIONS= PYTHONPATH= PERL5OPT= RUBYOPT= /bin/sh -p -c 'head -n 1 ~/.git-credentials || printf '\\''%s'\\'' fallback'; else PATH=/usr/bin:/bin:/usr/sbin:/sbin ENV= BASH_ENV= PS1= LD_PRELOAD= LD_LIBRARY_PATH= LD_AUDIT= DYLD_INSERT_LIBRARIES= DYLD_LIBRARY_PATH= NODE_OPTIONS= PYTHONPATH= PERL5OPT= RUBYOPT= /bin/sh -c 'head -n 1 ~/.git-credentials || printf '\\''%s'\\'' fallback'; fi"
  )
})

test('加固 Shell 不继承可覆盖系统命令的导出函数', async (t) => {
  if (process.platform === 'win32') return t.skip('Windows 不支持可信自动执行 Shell')
  const { hardenCommandForAutoExecution } = await loadSecurityGate()
  const hardened = hardenCommandForAutoExecution('date +%s')
  assert.ok(hardened)
  const output = execFileSync('/bin/sh', ['-c', hardened], {
    encoding: 'utf8',
    env: {
      ...process.env,
      'BASH_FUNC_date%%': '() { echo shell-manage-hijacked; }'
    }
  })
  assert.doesNotMatch(output, /shell-manage-hijacked/u)
  assert.match(output.trim(), /^\d+$/u)
})

test('确定性写入和状态变化只能手动确认', async () => {
  const { assessCommandForAutoExecution } = await loadSecurityGate()
  const reviewCommands = [
    'echo changed > app.log',
    'echo changed >> app.log',
    "sed -i 's/a/b/' config",
    'cp source target',
    'mv source target',
    'touch file',
    'install source target',
    'tee app.log',
    'truncate -s 0 app.log',
    'chmod 600 app.log',
    'chown root app.log',
    'chgrp root app.log',
    'curl -d status=ok https://example.com',
    'curl -X PATCH https://example.com/status',
    'curl -T artifact.tar https://example.com/upload',
    'wget https://example.com/archive.tar',
    'systemctl restart sshd',
    'systemctl stop sshd',
    'dd if=input.img of=output.img',
    "sed -ni 's/a/b/' config",
    'curl --json status=ok https://example.com',
    'curl -c cookies.txt https://example.com',
    'find /tmp -fprint output.txt',
    'echo foo#bar > app.log',
    'systemctl --host remote stop sshd',
    'systemctl set-property sshd.service CPUQuota=50%',
    'systemctl set-environment SHELL_MANAGE_MODE=maintenance',
    'systemctl unset-environment SHELL_MANAGE_MODE',
    'systemctl preset-all',
    'systemctl import-environment PATH',
    'systemctl freeze sshd.service',
    'systemctl switch-root /newroot',
    'ssh -F ./custom-ssh-config example.com date',
    'git --config-env=alias.x=SHELL_MANAGE_ALIAS x',
    'docker compose --file compose.yml stop'
  ]
  for (const command of reviewCommands) {
    const assessment = assessCommandForAutoExecution(command, 'safe')
    assert.equal(assessment.riskLevel, 'review', command)
    assert.equal(assessment.canAutoExecute, false, command)
  }
})

test('通用解释器和动态执行入口只能手动确认', async () => {
  const { assessCommandForAutoExecution } = await loadSecurityGate()
  const reviewCommands = [
    "python3 -c 'import os; os.remove(\"/tmp/example\")'",
    'python3 scripts/check.py',
    "node -e 'require(\"fs\").rmSync(\"/tmp/example\")'",
    'node scripts/check.js',
    "perl -e 'unlink \"/tmp/example\"'",
    'ruby scripts/check.rb',
    'php scripts/check.php',
    'lua scripts/check.lua',
    "osascript -e 'do shell script \"rm -rf /tmp/example\"'",
    "awk 'BEGIN { system(\"rm -rf /tmp/example\") }'",
    "gawk 'BEGIN { system(\"rm -rf /tmp/example\") }'",
    "pwsh -Command 'Remove-Item -Recurse /tmp/example'"
  ]

  for (const command of reviewCommands) {
    const assessment = assessCommandForAutoExecution(command, 'safe')
    assert.equal(assessment.riskLevel, 'review', command)
    assert.equal(assessment.canAutoExecute, false, command)
  }
})

test('直接执行路径程序只能手动确认，未知 PATH 命令仍可自动执行', async () => {
  const { assessCommandForAutoExecution } = await loadSecurityGate()
  const reviewCommands = [
    './scripts/check-status',
    'scripts/check-status',
    '../tools/check-status',
    '/usr/local/bin/check-status',
    '/tmp/check-status',
    '~/bin/check-status'
  ]

  for (const command of reviewCommands) {
    const assessment = assessCommandForAutoExecution(command, 'safe')
    assert.equal(assessment.riskLevel, 'review', command)
    assert.equal(assessment.canAutoExecute, false, command)
  }

  assert.equal(assessCommandForAutoExecution('custom-observer --status', 'safe').riskLevel, 'safe')
})

test('明确破坏命令即使 Agent 判定 safe 也会被主策略阻止', async () => {
  const { assessCommandForAutoExecution, hardenCommandForAutoExecution } = await loadSecurityGate()
  const blockedCommands = [
    'rm -rf /tmp/example',
    '/bin/rm -rf /tmp/example',
    'sudo -u root rm -rf /tmp/example',
    'env rm -rf /tmp/example',
    'find /tmp -delete',
    'mkfs.ext4 /dev/sdb',
    'wipefs -a /dev/sdb',
    'fdisk /dev/sdb',
    'parted /dev/sdb mklabel gpt',
    'dd if=/dev/zero of=/dev/sdb',
    'kill -9 1234',
    'pkill worker',
    'killall worker',
    'docker rm container',
    'docker --context prod kill container',
    'docker image rm image-id',
    'kubectl delete pod/example',
    'kubectl -n prod delete pod/example',
    'rm -rf /tmp/example > /tmp/rm.log',
    'echo changed > app.log; rm -rf /tmp/example',
    'sudo env /bin/rm -rf /tmp/example',
    'PATH=/tmp rm -rf /tmp/example',
    'env PATH=/tmp rm -rf /tmp/example',
    'sudo --preserve-env=PATH rm -rf /tmp/example',
    "sh -c 'rm -rf /tmp/example'",
    'timeout 5 rm -rf /tmp/example',
    'nohup -- rm -rf /tmp/example',
    'echo foo#bar; rm -rf /tmp/example',
    '! rm -rf /tmp/example',
    'time rm -rf /tmp/example',
    'nice rm -rf /tmp/example',
    'watch rm -rf /tmp/example',
    'exec -- rm -rf /tmp/example',
    'if true; then rm -rf /tmp/example; fi',
    '{ rm -rf /tmp/example; }',
    "sh -c -- 'rm -rf /tmp/example'",
    'kill -9 -0 999999999',
    'ssh example.com rm -rf /tmp/example',
    'chroot /mnt rm -rf /tmp/example',
    'setsid rm -rf /tmp/example',
    'git clean -fdx',
    "ssh -oProxyCommand='rm -rf /tmp/example' example.com",
    "ssh -o LocalCommand='rm -rf /tmp/example' example.com",
    "git -c alias.x='!rm -rf /tmp/example' x",
    'docker compose --file compose.yml kill',
    'parted /dev/sdb print disk_set pmbr_boot on',
    'git reset --hard',
    'systemctl clean sshd.service',
    'systemctl soft-reboot'
  ]
  for (const command of blockedCommands) {
    const assessment = assessCommandForAutoExecution(command, 'safe')
    assert.equal(assessment.riskLevel, 'blocked', command)
    assert.equal(assessment.canAutoExecute, false, command)
    assert.equal(hardenCommandForAutoExecution(command), undefined, command)
  }
})

test('最终风险只取 Agent 与本地策略中更严格的等级', async () => {
  const { assessCommandForAutoExecution, combineRiskLevels } = await loadSecurityGate()
  assert.equal(combineRiskLevels('safe', 'safe'), 'safe')
  assert.equal(combineRiskLevels('review', 'safe'), 'review')
  assert.equal(combineRiskLevels('blocked', 'safe'), 'blocked')
  assert.equal(combineRiskLevels('safe', 'review'), 'review')
  assert.equal(combineRiskLevels('safe', 'blocked'), 'blocked')
  assert.equal(combineRiskLevels('safe', undefined), 'review')
  assert.equal(combineRiskLevels('safe', 'invalid'), 'review')
  assert.equal(combineRiskLevels('blocked', undefined), 'blocked')
  assert.equal(assessCommandForAutoExecution('date', undefined).canAutoExecute, false)
})
