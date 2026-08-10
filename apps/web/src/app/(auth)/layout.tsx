import Link from 'next/link';

import { BrandLogo } from '@/components/brand-logo';
import { ThemeToggle } from '@/components/theme-toggle';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
      <div className="mb-8 flex items-start justify-between gap-4">
        {/* La marque devient un lien vers l'accueil : ces pages sont souvent la
            première du produit qu'on voit (un lien d'email, un partage), et
            elles n'offraient aucune sortie vers le site public. Le lockup porte
            déjà le mot « Lalanda », d'où la baseline seule en dessous. */}
        <Link
          href="/"
          aria-label="Lalanda — accueil"
          className="flex shrink-0 flex-col gap-1.5 transition hover:opacity-80"
        >
          <BrandLogo hauteur={34} />
          <span className="text-xs text-[var(--foreground-muted)]">
            Plan financier bancable en 30 min
          </span>
        </Link>
        <ThemeToggle />
      </div>
      <main className="flex flex-1 flex-col justify-center">{children}</main>
    </div>
  );
}
