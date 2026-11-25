import { useTranslation } from 'react-i18next'

const SOURCE_URL = 'https://github.com/ard0x10/mossread'

export default function App() {
  const { t } = useTranslation()

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">{t('app.name')}</span>
      </header>
      <main className="home">
        <h1 className="home-title">{t('app.tagline')}</h1>
        <p className="home-note">{t('app.privacy')}</p>
        <p className="home-status">{t('home.status')}</p>
      </main>
      <footer className="footer">
        <p className="footer-text">{t('footer.openSource')}</p>
        <a className="footer-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
          {t('footer.sourceCode')}
        </a>
      </footer>
    </div>
  )
}
