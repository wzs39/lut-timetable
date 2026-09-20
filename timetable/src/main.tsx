import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { ThemeProvider } from './theme.tsx'
import { applyPreset, applyTheme, loadPreset, loadTheme } from './lib/theme'
import { consumeWidgetNav } from './lib/widgetData'

// Satu-satunya langkah sebelum render pertama: tulis tema & preset tersimpan
// ke <html> supaya frame pertama sudah bertema benar (tidak ada kedip putih).
applyTheme(loadTheme())
applyPreset(loadPreset())

async function boot() {
  // Widget tap saat app MATI: MainActivity menulis view ke pref — baca dan
  // konsumsi SEBELUM render, karena view state App hanya dibaca sekali dari
  // location.hash saat mount. Web (bukan native) langsung render.
  const nav = await consumeWidgetNav()
  if (nav) location.hash = `#/view/${nav}`

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </StrictMode>,
  )
}

void boot()
