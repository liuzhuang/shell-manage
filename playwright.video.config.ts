import base from './playwright.config'

export default {
  ...base,
  use: {
    ...base.use,
    video: 'on',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
}
