import type { Metadata } from 'next';
import './globals.css';

// Poppins (brief §4) sera activée en S5 (interface) via `next/font/local`
// avec les .woff2 auto-hébergés — évite la dépendance réseau à Google Fonts.
// Voir docs/decisions.md.

export const metadata: Metadata = {
  title: 'Lalanda',
  description: 'Planification financière bancable — SYSCOHADA, RDC-first',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
