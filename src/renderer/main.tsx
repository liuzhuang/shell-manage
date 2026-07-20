import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/index.css'
import '@xterm/xterm/css/xterm.css'
import { applyTheme, applyThemePreset, resolveInitialTheme, resolveInitialThemePreset } from './styles/theme'

// Bootstrap with persisted theme.
applyThemePreset(resolveInitialThemePreset())
applyTheme(resolveInitialTheme())

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
