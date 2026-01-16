import { useTheme, getAvailableThemes, type ThemePreset } from './theme-provider'
import { Check, ChevronDown, Sun, Moon, Monitor } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { cn } from '../lib/utils'

// Theme color palette mapping - showing 4 key colors from each theme
const themeColors: Record<ThemePreset, string[]> = {
  default: ['#171717', '#ffffff', '#a3a3a3', '#525252'],
  forest: ['#1e7f5c', '#059669', '#34d399', '#6ee7b7'],
  nature: ['#44803f', '#65a34e', '#8bc34a', '#aed581'],
  america: ['#b91c1c', '#1e3a8a', '#ffffff', '#94a3b8'],
  ocean: ['#0c4a6e', '#0284c7', '#38bdf8', '#7dd3fc'],
  sunset: ['#ea580c', '#f59e0b', '#fbbf24', '#fcd34d'],
  lavender: ['#7c3aed', '#a78bfa', '#c4b5fd', '#ddd6fe'],
  halloween: ['#ea580c', '#171717', '#78350f', '#f97316'],
  winter: ['#b91c1c', '#15803d', '#fbbf24', '#ffffff'],
  valentine: ['#e11d48', '#f43f5e', '#fb7185', '#fda4af'],
  spring: ['#86efac', '#fcd34d', '#c4b5fd', '#f9a8d4'],
}

export function ThemeSwitcher() {
  const { preset, mode, setPreset, setMode } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const availableThemes = getAvailableThemes()

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const currentTheme = availableThemes.find(t => t.value === preset)
  const currentColors = themeColors[preset]

  return (
    <div className="space-y-3">
      {/* Mode Toggle */}
      <div>
        <div className="text-xs text-muted-foreground mb-2 font-medium">Color Mode</div>
        <div className="flex gap-1 p-1 bg-accent/50 rounded-lg">
          <button
            onClick={() => setMode('light')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition',
              mode === 'light'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Light mode"
          >
            <Sun size={14} />
            <span className="hidden sm:inline">Light</span>
          </button>
          <button
            onClick={() => setMode('dark')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition',
              mode === 'dark'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="Dark mode"
          >
            <Moon size={14} />
            <span className="hidden sm:inline">Dark</span>
          </button>
          <button
            onClick={() => setMode('system')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded text-xs font-medium transition',
              mode === 'system'
                ? 'bg-background shadow-sm text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            title="System preference"
          >
            <Monitor size={14} />
            <span className="hidden sm:inline">Auto</span>
          </button>
        </div>
      </div>

      {/* Theme Preset Dropdown */}
      <div className="relative" ref={dropdownRef}>
        <div className="text-xs text-muted-foreground mb-2 font-medium">Theme</div>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm border border-border bg-background hover:bg-accent hover:text-accent-foreground transition"
        >
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="grid grid-cols-2 gap-0.5">
              {currentColors.map((color, i) => (
                <div
                  key={i}
                  className="w-2.5 h-2.5 rounded-full border border-black/10 dark:border-white/10"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <span className="flex items-center gap-1.5 flex-1 text-left min-w-0">
            <span className="truncate">{currentTheme?.label || 'Theme'}</span>
            {currentTheme?.seasonal?.emoji && (
              <span className="flex-shrink-0">{currentTheme.seasonal.emoji}</span>
            )}
          </span>
          <ChevronDown size={16} className={cn('transition-transform flex-shrink-0', isOpen && 'rotate-180')} />
        </button>

        {isOpen && (
          <div className="absolute left-0 right-0 mt-2 rounded-lg border border-border bg-card shadow-lg z-50 max-h-[400px] overflow-y-auto">
            <div className="p-1">
              {availableThemes.map((t) => {
                const colors = themeColors[t.value]
                return (
                  <button
                    key={t.value}
                    onClick={() => {
                      setPreset(t.value)
                      setIsOpen(false)
                    }}
                    className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-md text-sm hover:bg-accent transition text-left group"
                  >
                    {/* Color dots in 2x2 grid */}
                    <div className="grid grid-cols-2 gap-0.5 flex-shrink-0">
                      {colors.map((color, i) => (
                        <div
                          key={i}
                          className="w-2.5 h-2.5 rounded-full border border-black/10 dark:border-white/10 transition-transform group-hover:scale-110"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>

                    {/* Theme name and info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{t.label}</span>
                        {t.seasonal?.emoji && (
                          <span className="text-base flex-shrink-0">{t.seasonal.emoji}</span>
                        )}
                        {preset === t.value && (
                          <Check size={14} className="text-primary flex-shrink-0 ml-auto" />
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{t.description}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
