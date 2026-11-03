import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

import { CookieBanner } from '@/components/cookie-consent';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';

// IBM Plex Sans — police de texte (ADR-0055, remplace Poppins). woff2
// auto-hébergés dans public/fonts/ (sous-ensemble latin de @fontsource/ibm-plex-sans
// 5.3.0, licence OFL 1.1) pour ne pas dépendre de fonts.gstatic.com au build.
const plexSans = localFont({
  src: [
    { path: '../../public/fonts/plexsans-400.woff2', weight: '400', style: 'normal' },
    { path: '../../public/fonts/plexsans-500.woff2', weight: '500', style: 'normal' },
    { path: '../../public/fonts/plexsans-600.woff2', weight: '600', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-sans',
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

// Script inline qui pose `data-ui-theme` et `data-theme` avant le premier paint,
// pour éviter le flash d'un thème à l'autre (FOUC). Voir `@/lib/theme-boot`.

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html
      lang="fr"
      className={`${plexSans.variable} ${archivo.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* Bannière de consentement — montée à la racine, donc présente sur les
            pages publiques COMME dans l'application : un visiteur peut arriver
            directement sur /login sans jamais voir la page d'accueil. Elle ne
            s'affiche que tant qu'aucun choix n'a été exprimé (S22c). */}
        <CookieBanner />
      </body>
    </html>
  );
}
