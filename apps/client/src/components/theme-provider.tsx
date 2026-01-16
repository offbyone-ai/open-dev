import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type ThemePreset = 'default' | 'forest' | 'nature' | 'america' | 'ocean' | 'sunset' | 'lavender' | 'halloween' | 'winter' | 'valentine' | 'spring'
type ThemeMode = 'light' | 'dark' | 'system'

type ThemeProviderProps = {
  children: ReactNode
  defaultPreset?: ThemePreset
  defaultMode?: ThemeMode
  presetStorageKey?: string
  modeStorageKey?: string
}

type ThemeProviderState = {
  preset: ThemePreset
  mode: ThemeMode
  resolvedMode: 'light' | 'dark'
  setPreset: (preset: ThemePreset) => void
  setMode: (mode: ThemeMode) => void
}

const initialState: ThemeProviderState = {
  preset: 'default',
  mode: 'system',
  resolvedMode: 'light',
  setPreset: () => null,
  setMode: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({
  children,
  defaultPreset = 'default',
  defaultMode = 'system',
  presetStorageKey = 'open-dev-theme-preset',
  modeStorageKey = 'open-dev-theme-mode',
  ...props
}: ThemeProviderProps) {
  const [preset, setPresetState] = useState<ThemePreset>(() => {
    const stored = localStorage.getItem(presetStorageKey) as ThemePreset
    return stored || defaultPreset
  })

  const [mode, setModeState] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem(modeStorageKey) as ThemeMode
    return stored || defaultMode
  })

  const [resolvedMode, setResolvedMode] = useState<'light' | 'dark'>(() => {
    if (mode === 'system') {
      return getSystemTheme()
    }
    return mode
  })

  // Apply theme to document
  useEffect(() => {
    const root = window.document.documentElement

    // Remove all possible classes
    root.classList.remove('light', 'dark')

    // Apply the resolved mode (light or dark)
    root.classList.add(resolvedMode)

    // Apply theme preset as data attribute
    if (preset === 'default') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', preset)
    }
  }, [preset, resolvedMode])

  // Listen for system theme changes (only when mode is 'system')
  useEffect(() => {
    if (mode !== 'system') {
      return
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => {
      setResolvedMode(getSystemTheme())
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [mode])

  // Update resolved mode when mode changes
  useEffect(() => {
    if (mode === 'system') {
      setResolvedMode(getSystemTheme())
    } else {
      setResolvedMode(mode)
    }
  }, [mode])

  const value = {
    preset,
    mode,
    resolvedMode,
    setPreset: (newPreset: ThemePreset) => {
      localStorage.setItem(presetStorageKey, newPreset)
      setPresetState(newPreset)
    },
    setMode: (newMode: ThemeMode) => {
      localStorage.setItem(modeStorageKey, newMode)
      setModeState(newMode)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider')

  return context
}

type ThemeInfo = {
  value: ThemePreset
  label: string
  description: string
  seasonal?: {
    months: number[]
    emoji?: string
  }
}

const allThemePresets: ThemeInfo[] = [
  { value: 'default', label: 'Default', description: 'Clean and minimal design' },
  { value: 'forest', label: 'Forest', description: 'Bold green accents inspired by nature' },
  { value: 'nature', label: 'Nature', description: 'Soft earth tones and organic colors' },
  { value: 'america', label: 'America', description: 'Patriotic red, white, and blue palette' },
  { value: 'ocean', label: 'Ocean', description: 'Calm blues and aqua tones' },
  { value: 'sunset', label: 'Sunset', description: 'Warm oranges and golden hues' },
  { value: 'lavender', label: 'Lavender Haze', description: 'Dreamy purples and soft violet tones' },
  {
    value: 'halloween',
    label: 'Halloween',
    description: 'Spooky oranges and blacks',
    seasonal: { months: [9], emoji: '🎃' }
  },
  {
    value: 'winter',
    label: 'Winter Holiday',
    description: 'Festive reds, greens, and golds',
    seasonal: { months: [11], emoji: '❄️' }
  },
  {
    value: 'valentine',
    label: 'Valentine',
    description: 'Romantic pinks and reds',
    seasonal: { months: [1], emoji: '💕' }
  },
  {
    value: 'spring',
    label: 'Spring Bloom',
    description: 'Fresh pastels and blooming colors',
    seasonal: { months: [3], emoji: '🌸' }
  },
]

export function getAvailableThemes(): ThemeInfo[] {
  const currentMonth = new Date().getMonth()

  return allThemePresets.filter(theme => {
    if (!theme.seasonal) return true
    return theme.seasonal.months.includes(currentMonth)
  })
}

export const themePresets: Array<{ value: ThemePreset; label: string; description: string }> = allThemePresets

export const themeModes: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Light mode' },
  { value: 'dark', label: 'Dark', description: 'Dark mode' },
  { value: 'system', label: 'System', description: 'Follow system preference' },
]

export type { ThemePreset, ThemeMode }
