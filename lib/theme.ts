export type Theme = 'light' | 'dark' | 'auto'

export function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark'
  const stored = localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    return stored
  }
  return 'dark'
}

export function applyTheme(theme: Theme) {
  if (typeof window === 'undefined') return

  const effectiveTheme = theme === 'auto' ? getSystemTheme() : theme

  if (effectiveTheme === 'dark') {
    document.documentElement.classList.add('dark')
    document.documentElement.classList.remove('light')
  } else {
    document.documentElement.classList.remove('dark')
    document.documentElement.classList.add('light')
  }

  localStorage.setItem('theme', theme)
}
