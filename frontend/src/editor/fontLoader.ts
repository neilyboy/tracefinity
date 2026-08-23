// Font loader: injects @font-face CSS for bundled fonts so they can be
// used in SVG text previews. Each font is loaded once and cached.

import type { FontInfo } from '../types'

let _loadedFonts = new Set<string>()  // CSS family names already injected
let _fontsCache: FontInfo[] | null = null

/**
 * Inject @font-face CSS for a single font if not already loaded.
 */
function injectFontFace(font: FontInfo) {
  if (_loadedFonts.has(font.css_family)) return
  _loadedFonts.add(font.css_family)

  const css = `
    @font-face {
      font-family: "${font.css_family}";
      src: url("${font.url}") format("truetype");
      font-weight: normal;
      font-style: normal;
      font-display: block;
    }
  `
  const style = document.createElement('style')
  style.setAttribute('data-tracefinity-font', font.css_family)
  style.textContent = css
  document.head.appendChild(style)
}

/**
 * Load all bundled fonts from the API and inject @font-face CSS for each.
 * Returns the list of available fonts. Results are cached.
 */
export async function loadAllFonts(): Promise<FontInfo[]> {
  if (_fontsCache) return _fontsCache
  try {
    const res = await fetch('/api/designs/fonts/list')
    if (!res.ok) return []
    const fonts: FontInfo[] = await res.json()
    _fontsCache = fonts
    // Inject @font-face for all fonts up front so they're ready when needed
    for (const f of fonts) {
      injectFontFace(f)
    }
    return fonts
  } catch {
    return []
  }
}

/**
 * Ensure a specific font is loaded by its CSS family name.
 * If it's a bundled font, the @font-face is already injected by loadAllFonts.
 * If it's a system font (Arial, etc.), nothing to do.
 */
export function ensureFontLoaded(cssFamily: string, fonts: FontInfo[]) {
  const font = fonts.find((f) => f.css_family === cssFamily)
  if (font) {
    injectFontFace(font)
  }
}

/**
 * Get the cached font list (empty if not yet loaded).
 */
export function getCachedFonts(): FontInfo[] {
  return _fontsCache || []
}

/**
 * Map a label's font key to a CSS font-family name.
 * For bundled fonts, returns the css_family from the font info.
 * For system fonts (Arial, etc.), returns the name directly.
 */
export function fontKeyToCssFamily(fontKey: string): string {
  const fonts = getCachedFonts()
  const font = fonts.find((f) => f.key === fontKey)
  if (font) return font.css_family
  // System font — return as-is
  return fontKey
}
