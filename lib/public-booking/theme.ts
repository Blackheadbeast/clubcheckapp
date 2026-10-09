// The look of a gym's booking page: the app's own design tokens, re-pointed at the gym's colour
// and chosen appearance. Everything that reaches the stylesheet is computed here from a colour
// that has already been checked to be six hex digits, so settings can never inject CSS.

const LIGHT = { bg: '248 250 252', card: '255 255 255', lighter: '241 245 249', border: '226 232 240', text: '30 41 59', secondary: '71 85 105', muted: '100 116 139', heading: '15 23 42', success: '22 101 52', danger: '153 27 27', warning: '146 64 14' }
const DARK = { bg: '10 10 10', card: '23 23 23', lighter: '32 32 32', border: '48 48 48', text: '243 244 246', secondary: '176 182 192', muted: '128 135 148', heading: '250 250 250', success: '74 222 128', danger: '248 113 113', warning: '251 191 36' }

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const mix = (c: number[], with_: number, amount: number) => c.map((v) => Math.round(v + (with_ - v) * amount))
const luminance = ([r, g, b]: number[]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: number[], b: number[]) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }

/** The gym's colour as text on a surface: moved towards black or white until it can be read. */
function readable(color: number[], surface: number[], towards: number) {
  let c = color
  for (let i = 0; i < 12 && contrast(c, surface) < 4.5; i++) c = mix(c, towards, 0.15)
  return c
}

function vars(set: typeof LIGHT, color: number[], dark: boolean) {
  const onAccent = contrast(color, [255, 255, 255]) >= contrast(color, [23, 23, 23]) ? '255 255 255' : '23 23 23'
  const text = readable(color, set.card.split(' ').map(Number), dark ? 255 : 0)
  return `--color-bg:${set.bg};--color-bg-card:${set.card};--color-bg-lighter:${set.lighter};--color-border:${set.border};--color-text:${set.text};--color-text-secondary:${set.secondary};--color-text-muted:${set.muted};--color-text-heading:${set.heading};--color-text-success:${set.success};--color-text-danger:${set.danger};--color-text-warning:${set.warning};--color-accent:${color.join(' ')};--color-accent-fg:${onAccent};--color-accent-text:${text.join(' ')};color-scheme:${dark ? 'dark' : 'light'};`
}

export function themeCss(theme: { primaryColor: string; buttonStyle: string; appearance: string }) {
  const color = /^#[0-9a-f]{6}$/i.test(theme.primaryColor) ? rgb(theme.primaryColor) : [37, 99, 235]
  const light = vars(LIGHT, color, false)
  const dark = vars(DARK, color, true)
  const radius = theme.buttonStyle === 'pill' ? '9999px' : theme.buttonStyle === 'square' ? '4px' : '10px'
  // html:root and html.dark both, so the staff app's own light/dark switch has no say here.
  const base = theme.appearance === 'dark' ? `html:root,html.dark{${dark}}` : theme.appearance === 'auto' ? `html:root,html.dark{${light}}@media (prefers-color-scheme: dark){html:root,html.dark{${dark}}}` : `html:root,html.dark{${light}}`
  return `${base}.bk-root{--bk-radius:${radius}}.bk-root button,.bk-root a.bk-btn{border-radius:var(--bk-radius)}.bk-root button.bk-plain{border-radius:8px}`
}

/**
 * Sets light or dark on the page before it paints. The app marks dark mode with a class on <html>,
 * which the staff app controls everywhere else; here the gym's setting decides. A fixed string per
 * choice: nothing from settings is interpolated into it.
 */
export function appearanceScript(appearance: string) {
  if (appearance === 'dark') return "document.documentElement.classList.add('dark')"
  if (appearance === 'auto') return "document.documentElement.classList.toggle('dark',window.matchMedia('(prefers-color-scheme: dark)').matches)"
  return "document.documentElement.classList.remove('dark')"
}
