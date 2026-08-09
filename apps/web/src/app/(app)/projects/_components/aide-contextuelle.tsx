// Liens d'aide contextuels de la vue résultats (S22d).
//
// Deux partis pris :
//
//  1. **Discret.** Un lien texte sous les onglets, pas une bulle, pas une
//     pastille clignotante. Quelqu'un qui sait lire un bilan ne doit pas avoir
//     l'aide dans les yeux à chaque visite.
//  2. **Nouvel onglet.** L'utilisateur est au milieu de ses chiffres ; l'envoyer
//     sur une page d'aide dans le même onglet lui ferait perdre sa feuille
//     ouverte et son défilement. L'ouverture externe est annoncée aux lecteurs
//     d'écran, jamais laissée implicite.
//
// Les cibles ne sont pas écrites ici : elles viennent de `LIENS_AIDE`
// (`lib/aide`), que `liens.test.ts` vérifie contre les ancres réelles. Un lien
// d'aide en dur dans un composant échapperait à ce contrôle.

import Link from 'next/link';

import { lienAidePourFeuille } from '@/lib/aide/liens';

const CLASSES =
  'inline-flex items-center gap-1 text-[0.78rem] text-[var(--foreground-muted)] underline decoration-[var(--border-strong)] underline-offset-2 transition hover:text-[var(--accent)] hover:decoration-[var(--accent)]';

/** Lien vers l'explication de la feuille de résultats affichée. */
export function LienAideFeuille({
  idFeuille,
  libelleFeuille,
}: {
  idFeuille: string;
  libelleFeuille: string;
}): React.ReactElement | null {
  const href = lienAidePourFeuille(idFeuille);
  // Une feuille sans article dédié n'affiche aucun lien : mieux vaut rien
  // qu'une promesse d'explication qui renvoie sur une page générique.
  if (!href) return null;

  return (
    <p className="flex justify-end">
      <Link href={href} target="_blank" rel="noopener" className={CLASSES}>
        <span aria-hidden="true">?</span>
        Comprendre la feuille « {libelleFeuille} »
        <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
      </Link>
    </p>
  );
}

/** Lien vers l'article des ratios, depuis le bandeau de feux tricolores. */
export function LienAideRatios({ href }: { href: string }): React.ReactElement {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      className={`${CLASSES} ml-auto shrink-0`}
      title="Ce que chaque ratio signifie et comment l’améliorer"
    >
      <span aria-hidden="true">?</span>
      Comprendre ces ratios
      <span className="sr-only"> (s’ouvre dans un nouvel onglet)</span>
    </Link>
  );
}
