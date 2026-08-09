'use client';

// Recherche du centre d'aide (S22d).
//
// Tout se passe dans le navigateur : l'index complet fait quelques dizaines de
// sections, il voyage avec la page. Pas d'aller-retour réseau, donc pas de
// latence ni d'état de chargement à gérer — et la recherche marche aussi bien
// pour un visiteur non authentifié.
//
// L'index est passé en props par le composant serveur : le contenu des articles
// ne traverse pas la frontière client deux fois.

import Link from 'next/link';
import { useId, useMemo, useState } from 'react';

import { rechercher, type EntreeIndex } from '@/lib/aide/recherche';

export function RechercheAide({ index }: { index: EntreeIndex[] }): React.ReactElement {
  const [requete, setRequete] = useState('');
  const champId = useId();
  const resultatsId = useId();

  const resultats = useMemo(() => rechercher(index, requete), [index, requete]);
  const requeteUtile = requete.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor={champId} className="sr-only">
        Rechercher dans l’aide
      </label>
      <input
        id={champId}
        type="search"
        value={requete}
        onChange={(e) => setRequete(e.target.value)}
        placeholder="Rechercher : DSCR, trésorerie, export, apport…"
        autoComplete="off"
        aria-describedby={requeteUtile ? resultatsId : undefined}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[0.95rem] outline-none transition placeholder:text-[var(--foreground-muted)] focus:border-[var(--accent)]"
      />

      {requeteUtile ? (
        <div id={resultatsId} aria-live="polite" className="flex flex-col gap-2">
          <p className="font-mono text-[0.65rem] tracking-[0.1em] text-[var(--foreground-muted)]">
            {resultats.length === 0
              ? 'AUCUN RÉSULTAT'
              : `${resultats.length} RÉSULTAT${resultats.length > 1 ? 'S' : ''}`}
          </p>

          {resultats.length === 0 ? (
            <p className="text-[0.92rem] leading-relaxed text-[var(--foreground-muted)]">
              Aucune section ne contient tous ces mots. Essayez un terme plus court, ou parcourez le{' '}
              <Link href="/aide/glossaire" className="text-[var(--accent)] underline">
                glossaire
              </Link>
              .
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {resultats.map((resultat) => (
                <li key={resultat.href}>
                  <Link
                    href={resultat.href}
                    className="block rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3 transition hover:border-[var(--accent)]/40 hover:bg-[var(--surface-muted)]"
                  >
                    <span className="font-mono block text-[0.6rem] tracking-[0.1em] text-[var(--foreground-muted)] uppercase">
                      {resultat.titreArticle}
                    </span>
                    <span className="mt-1 block text-[0.95rem] font-medium text-[var(--foreground)]">
                      {resultat.titreSection}
                    </span>
                    <span className="mt-1 block text-[0.85rem] leading-relaxed text-[var(--foreground-muted)]">
                      {resultat.extrait}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
