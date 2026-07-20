import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const websiteRoot = __dirname

function documentationPlugin(): Plugin {
  const prepareDocumentationResponse = (
    request: { url?: string },
    response: { setHeader: (name: string, value: string) => void },
    next: () => void
  ): void => {
    const [pathname, query] = request.url?.split('?') ?? []
    const documentRoutes: Record<string, string> = {
      '/doc/install/': '/doc/install/index.html',
      '/doc/shell-manage-assistant/': '/doc/shell-manage-assistant/index.html'
    }

    if (pathname && documentRoutes[pathname]) {
      request.url = `${documentRoutes[pathname]}${query ? `?${query}` : ''}`
    }
    if (pathname?.endsWith('.md')) {
      response.setHeader('Content-Type', 'text/markdown; charset=utf-8')
    }
    next()
  }

  return {
    name: 'documentation-routes',
    configureServer: (server) => {
      server.middlewares.use(prepareDocumentationResponse)
    },
    configurePreviewServer: (server) => {
      server.middlewares.use(prepareDocumentationResponse)
    }
  }
}

export default defineConfig({
  root: websiteRoot,
  plugins: [react(), documentationPlugin()],
  build: {
    outDir: resolve(websiteRoot, '../dist-website'),
    emptyOutDir: true
  }
})
