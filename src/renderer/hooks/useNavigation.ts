import { useCallback, useState } from 'react'

const LAST_APP_PAGE_KEY = 'app.lastPage.v1'

export type AppPage =
  | 'home'
  | 'log'
  | 'multiLog'
  | 'query'
  | 'editor'
  | 'ssh-keys'
  | 'collaboration'
  | 'terminal'
  | 'dashboard'
  | 'monitoring'
  | 'analytics'
  | 'browser'

export function useNavigation() {
  const [page, setPageState] = useState<AppPage>(() =>
    window.localStorage.getItem(LAST_APP_PAGE_KEY) === 'browser' ? 'browser' : 'home'
  )
  const [selectedCommand, setSelectedCommand] = useState('')
  const setPage = useCallback((nextPage: AppPage) => {
    window.localStorage.setItem(LAST_APP_PAGE_KEY, nextPage === 'browser' ? 'browser' : 'home')
    setPageState(nextPage)
  }, [])

  return {
    page,
    setPage,
    selectedCommand,
    setSelectedCommand
  }
}
