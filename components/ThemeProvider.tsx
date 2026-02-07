'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Theme, getStoredTheme, applyTheme, getSystemTheme } from '@/lib/theme'

interface ThemeContextType {
  theme: Theme
  setTheme: (theme: Theme) => void
  effectiveTheme: 'light' | 'dark'
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

interface ThemeProviderProps {
  children: ReactNode
}

export default function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>('dark')
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('dark')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // Initialize theme from localStorage
    const stored = getStoredTheme()
    setThemeState(stored)
    applyTheme(stored)
    setEffectiveTheme(stored === 'auto' ? getSystemTheme() : stored)
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted) return

    // Listen for system theme changes when in auto mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

    function handleChange() {
      if (theme === 'auto') {
        const newEffective = getSystemTheme()
        setEffectiveTheme(newEffective)
        applyTheme('auto')
      }
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme, mounted])

  function setTheme(newTheme: Theme) {
    setThemeState(newTheme)
    applyTheme(newTheme)
    setEffectiveTheme(newTheme === 'auto' ? getSystemTheme() : newTheme)

    // Sync to server (non-blocking)
    fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: newTheme }),
      credentials: 'include',
    }).catch(() => {
      // Ignore server sync errors
    })
  }

  // Prevent flash of wrong theme
  if (!mounted) {
    return null
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, effectiveTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
