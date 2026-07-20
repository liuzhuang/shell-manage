import { useId } from 'react'
import type { ThemeName } from '../styles/tokens'
import './ThemeToggleE.css'

function DayPeepIcon({ daySkyId, dayLandId }: { daySkyId: string; dayLandId: string }) {
  return (
    <svg viewBox="0 0 44 44" aria-hidden>
      <defs>
        <linearGradient id={daySkyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tte-day-sky-top)" />
          <stop offset="100%" stopColor="var(--tte-day-sky-bottom)" />
        </linearGradient>
        <linearGradient id={dayLandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tte-day-land-top)" />
          <stop offset="100%" stopColor="var(--tte-day-land-bottom)" />
        </linearGradient>
      </defs>
      <rect width="44" height="26" fill={`url(#${daySkyId})`} />
      <rect y="26" width="44" height="18" fill={`url(#${dayLandId})`} />
      <path d="M0 26 Q14 22 22 26 T44 26" fill="var(--tte-day-horizon)" />
      <circle cx="32" cy="11" r="5" fill="var(--tte-day-sun)" opacity="0.95" />
    </svg>
  )
}

function NightPeepIcon({ nightSkyId, nightLandId }: { nightSkyId: string; nightLandId: string }) {
  return (
    <svg viewBox="0 0 44 44" aria-hidden>
      <defs>
        <linearGradient id={nightSkyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tte-night-sky-top)" />
          <stop offset="100%" stopColor="var(--tte-night-sky-bottom)" />
        </linearGradient>
        <linearGradient id={nightLandId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tte-night-land-top)" />
          <stop offset="100%" stopColor="var(--tte-night-land-bottom)" />
        </linearGradient>
      </defs>
      <rect width="44" height="28" fill={`url(#${nightSkyId})`} />
      <rect y="28" width="44" height="16" fill={`url(#${nightLandId})`} />
      <path d="M0 28 Q12 24 22 28 T44 27" fill="var(--tte-night-horizon)" />
      <circle cx="30" cy="10" r="4" fill="var(--tte-night-moon)" />
      <circle cx="10" cy="8" r="0.8" fill="var(--tte-night-star)" />
      <circle cx="18" cy="5" r="0.5" fill="var(--tte-night-star)" />
      <circle cx="24" cy="14" r="0.5" fill="var(--tte-night-star)" />
    </svg>
  )
}

export function ThemeToggleE({ theme, onToggle }: { theme: ThemeName; onToggle: () => void }) {
  const uid = useId().replace(/:/g, '')
  const daySkyId = `${uid}-daySky`
  const dayLandId = `${uid}-dayLand`
  const nightSkyId = `${uid}-nightSky`
  const nightLandId = `${uid}-nightLand`
  const isDark = theme === 'dark'
  const ariaLabel = isDark ? '切换到浅色模式' : '切换到暗色模式'

  return (
    <button
      type="button"
      data-testid="theme-toggle"
      className={`theme-toggle-e${isDark ? ' theme-toggle-e--dark' : ' theme-toggle-e--light'}`}
      aria-label={ariaLabel}
      title={ariaLabel}
      onClick={onToggle}
    >
      <span className="theme-toggle-e__track">
        <span className="theme-toggle-e__ball" aria-hidden>
          {isDark ? (
            <DayPeepIcon daySkyId={daySkyId} dayLandId={dayLandId} />
          ) : (
            <NightPeepIcon nightSkyId={nightSkyId} nightLandId={nightLandId} />
          )}
        </span>
      </span>
    </button>
  )
}
