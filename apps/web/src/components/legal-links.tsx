// Liens vers les documents légaux, dérivés du registre `lib/legal.ts` (S22c).
//
// POURQUOI UN COMPOSANT ET PAS CINQ `<Link>` RECOPIÉS DANS CHAQUE PIED DE PAGE :
// une page légale existe pour être trouvée. Une page publiée mais absente des
// footers n'est pas seulement invisible — elle est difficilement opposable, et
// rien dans le build ne signale son absence. En dérivant la liste du registre,
// ajouter un document au registre l'ajoute partout, et en retirer un le retire
// partout. C'est la seule façon de ne pas avoir à y penser.
//
// Deux pieds de page consomment ce composant : le layout marketing (panneau
// encre) et le layout applicatif (fond clair). D'où la variante de couleur.

import Link from 'next/link';

import { LEGAL_DOCUMENTS } from '@/lib/legal';

export function LegalLinks({
  tone = 'default',
  className,
}: {
  /** `ink` pour les pieds de page sur panneau sombre, `default` sinon. */
  tone?: 'default' | 'ink';
  className?: string;
}): React.ReactElement {
  const linkClass =
    tone === 'ink'
      ? 'transition hover:text-[var(--on-ink)]'
      : 'text-[var(--foreground-muted)] transition hover:text-[var(--foreground)]';

  return (
    <nav aria-label="Documents légaux" className={className}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {LEGAL_DOCUMENTS.map((doc) => (
          <li key={doc.slug}>
            <Link href={doc.href} className={linkClass}>
              {doc.shortTitle}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
