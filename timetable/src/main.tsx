import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n.tsx'
import { ThemeProvider } from './theme.tsx'
import { applyTheme, loadTheme } from './lib/theme'

// Satu-satunya langkah sebelum render pertama: tulis tema tersimpan ke <html>
// supaya frame pertama sudah bertema benar (tidak ada kedip putih).
applyTheme(loadTheme())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <App />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
