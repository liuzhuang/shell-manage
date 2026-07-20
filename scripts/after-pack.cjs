const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { Arch } = require('builder-util')

const FEED_BASE_URL = 'https://github.com/liuzhuang/shell-manage/releases/latest/download'

module.exports = async function configureMacUpdateFeed(context) {
  if (context.electronPlatformName !== 'darwin') return

  const architecture = Arch[context.arch]
  if (architecture !== 'x64' && architecture !== 'arm64') {
    throw new Error(`Unsupported macOS update architecture: ${architecture}`)
  }

  const appName = context.packager.appInfo.productFilename
  const infoPlist = join(context.appOutDir, `${appName}.app`, 'Contents', 'Info.plist')
  const feedUrl = `${FEED_BASE_URL}/appcast-mac-${architecture}.xml`

  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :SUFeedURL ${feedUrl}`, infoPlist])
}
