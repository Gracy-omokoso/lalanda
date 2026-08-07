import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

// Poppins — brief §4. Chargée via next/font/local avec woff2 auto-hébergés
// dans public/fonts/ pour éviter la dépendance réseau à fonts.gstatic.com au build.
// Voir docs/decisions.md 2026-07-30.
const poppins = localFont({
  src: [
    { path: '../../public/fonts/poppins-400.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/poppins-500.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/poppins-600.woff2', weight: '600', style: 'normal' },
    { path: '../../public/fonts/poppins-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-poppins',
  fallback: [
    'ui-sans-serif',
    'system-ui',
    '-apple-system',
    'Segoe UI',
    'Roboto',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
});

// Archivo (variable 100→900) — face display des titres, direction « dossier bancaire ».
const archivo = localFont({
  src: [{ path: '../../public/fonts/archivo-var.woff2', weight: '100 900', style: 'normal' }],
  display: 'swap',
  variable: '--font-archivo',
  fallback: ['ui-sans-serif', 'system-ui', 'Arial', 'sans-serif'],
});

// IBM Plex Mono — chiffres tabulaires, libellés registre, tampons.
const plexMono = localFont({
  src: [
    { path: '../../public/fonts/plexmono-400.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/plexmono-500.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/plexmono-600.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-mono',
  fallback: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas', 'monospace'],
});

export const metadata: Metadata = {
  title: 'Lalanda — Planification financière bancable',
  description:
    'SaaS de plans financiers bancables (SYSCOHADA, RDC-first). Générez en <30 min votre dossier prêt banque.',
};

// Preload d'un mini-script inline qui applique le thème avant le premier paint
// pour éviter le flash light→dark (FOUC).
const setInitialThemeScript = `
(function() {
  try {
    var pref = localStorage.getItem('theme');
    var systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = pref || (systemDark ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html
      lang="fr"
      className={`${poppins.variable} ${archivo.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: setInitialThemeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
