import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFileSize } from '../lib/useFileSize'
import { ScanIcon } from '../ui/icons'
import { defaultOcrLang, downloadSize, OCR_LANGS, type OcrLang } from './engine'

interface OcrOfferProps {
  onStart: (lang: OcrLang) => void
}

/** Shown in place of the text of a scanned PDF: reading its text starts only when asked. */
export function OcrOffer({ onStart }: OcrOfferProps) {
  const { t } = useTranslation()
  const fileSize = useFileSize()
  const [lang, setLang] = useState<OcrLang>(defaultOcrLang)

  return (
    <div className="ocr-offer">
      <p className="ocr-offer-title">{t('ocr.title')}</p>
      <p className="ocr-offer-body">{t('ocr.body')}</p>
      <p className="ocr-offer-label" id="ocr-lang">
        {t('ocr.language')}
      </p>
      <div className="segmented" role="group" aria-labelledby="ocr-lang">
        {OCR_LANGS.map((value) => (
          <button
            key={value}
            type="button"
            className="segmented-option"
            aria-pressed={lang === value}
            onClick={() => setLang(value)}
          >
            {t(`ocr.lang.${value}`)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="button-primary ocr-offer-start icon-action"
        aria-label={t('ocr.start', { size: fileSize(downloadSize(lang)) })}
        onClick={() => onStart(lang)}
      >
        <ScanIcon />
        {fileSize(downloadSize(lang))}
      </button>
      <p className="ocr-offer-note">{t('ocr.note')}</p>
    </div>
  )
}
