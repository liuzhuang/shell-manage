import { app } from 'electron'
import { buildLoginItemSettings } from './login-item-settings'

export { buildLoginItemSettings } from './login-item-settings'

export function syncLaunchAtLogin(enabled: boolean): void {
  app.setLoginItemSettings(buildLoginItemSettings(enabled))
}

export function getLaunchAtLogin(): boolean {
  return app.getLoginItemSettings().openAtLogin
}
