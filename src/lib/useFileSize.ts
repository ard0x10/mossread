import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** Formats a byte count for the reader's language, as in "4.2 MB". */
export function useFileSize() {
  const { i18n } = useTranslation()
  return useMemo(() => {
    const units = ['byte', 'kilobyte', 'megabyte', 'gigabyte'] as const
    return (bytes: number) => {
      let value = bytes
      let unit = 0
      while (value >= 1000 && unit < units.length - 1) {
        value /= 1000
        unit++
      }
      return new Intl.NumberFormat(i18n.language, {
        style: 'unit',
        unit: units[unit],
        unitDisplay: 'short',
        maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
      }).format(value)
    }
  }, [i18n.language])
}
