import { useEffect, useState } from 'react'

export function useWindowFullscreen(): boolean {
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    let alive = true

    const sync = async () => {
      const { fullscreen: next } = await window.api.getWindowFullscreen()
      if (alive) setFullscreen(next)
    }

    void sync()
    const off = window.api.onWindowFullscreenChanged(({ fullscreen: next }) => {
      setFullscreen(next)
    })

    return () => {
      alive = false
      off()
    }
  }, [])

  return fullscreen
}
