import { useTranslation } from 'react-i18next'

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
    </div>
  )
}
