import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '../locales/en/common.json'

type Messages = Record<string, unknown>

export const FALLBACK_LANGUAGE = 'en'
const STORAGE_KEY = 'mossread.language'

// English is bundled because it is the fallback. Any other folder under
// src/locales becomes a language automatically and is fetched only when chosen.
const otherLocales = import.meta.glob<Messages>(
  ['../locales/*/common.json', '!../locales/en/common.json'],
  { import: 'default' },
)

const languageOf = (path: string) => path.split('/').at(-2) ?? ''

export const SUPPORTED_LANGUAGES: readonly string[] = [
  FALLBACK_LANGUAGE,
  ...Object.keys(otherLocales).map(languageOf).sort(),
]

function readStoredLanguage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function storeLanguage(language: string) {
  try {
    localStorage.setItem(STORAGE_KEY, language)
  } catch {
    // Private mode or blocked storage: the choice simply lasts for this visit.
  }
}

// Matches "pt-BR" to "pt-BR" first, then to "pt". Unknown tags fall through.
function matchSupported(tag: string): string | undefined {
  const lower = tag.toLowerCase()
  const base = lower.split('-')[0]
  return (
    SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === lower) ??
    SUPPORTED_LANGUAGES.find((l) => l.toLowerCase() === base)
  )
}

function detectLanguage(): string {
  const candidates = [readStoredLanguage(), ...(navigator.languages ?? [navigator.language])]
  for (const tag of candidates) {
    const match = tag ? matchSupported(tag) : undefined
    if (match) return match
  }
  return FALLBACK_LANGUAGE
}

async function ensureLoaded(language: string) {
  if (i18n.hasResourceBundle(language, 'common')) return
  const loader = Object.entries(otherLocales).find(([path]) => languageOf(path) === language)?.[1]
  if (!loader) throw new Error(`No messages for language "${language}"`)
  i18n.addResourceBundle(language, 'common', await loader())
}

export async function setLanguage(language: string) {
  const match = matchSupported(language) ?? FALLBACK_LANGUAGE
  await ensureLoaded(match)
  await i18n.changeLanguage(match)
  storeLanguage(match)
}

// Keeps <html lang> and text direction in step, so screen readers, hyphenation
// and right-to-left languages follow the interface language.
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
  document.documentElement.dir = i18n.dir(language)
})

i18n.use(initReactI18next).init({
  resources: { en: { common: en } },
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  defaultNS: 'common',
  ns: ['common'],
  initAsync: false,
  interpolation: { escapeValue: false },
})

const detected = detectLanguage()
if (detected !== FALLBACK_LANGUAGE) {
  void setLanguage(detected)
}

export default i18n
