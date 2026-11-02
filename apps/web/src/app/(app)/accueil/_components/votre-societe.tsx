'use client';

// Carte « Votre société » (ADR-0052 § 3). ADR-0052 — O4.
//
// Facturer · Normaliser · Comptabilité, prêtes ou non, avec ce qui manque et qui peut le
// faire ; un lien direct vers l'étape suivante. Lue sur `GET /organizations/current/setup`,
// ouverte à tout membre (un invité la lit sans pouvoir agir sur les étapes fermées).

import Link from 'next/link';

import { useMiseEnRoute } from '../../organisation/_components/use-mise-en-route';

import { carteSociete } from './votre-societe-model';

export function VotreSocieteCarte(): React.ReactElement | null {
  const { vue } = useMiseEnRoute();
  const carte = carteSociete(vue);
  if (carte === null) return null;
  const { suivante } = carte;
  return (
    <div className="relative flex min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-[var(--border-strong)] hover:shadow-[var(--shadow-pop)]">
      <h3 className="text-sm font-semibold">
        Votre société · {carte.faites}/{carte.total}
      </h3>
      <div
        aria-hidden="true"
        className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]"
      >
        <div
          className="h-full rounded-full bg-[var(--accent)]"
          style={{ width: `${carte.pourcent}%` }}
        />
      </div>
      <ul className="flex flex-col gap-1.5" aria-label="Ce que votre société peut faire">
        {carte.pastilles.map((p) => (
          <li key={p.id} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${p.pret ? 'bg-[var(--ok)]' : p.id === 'invoice' ? 'bg-[var(--danger)]' : 'bg-[var(--border-strong)]'}`}
            />
            <span className="min-w-0">
              <span className="font-medium">{p.label}</span>
              <span className="sr-only">{p.pret ? ' : prêt.' : ' : pas encore.'}</span>{' '}
              <span className="text-[var(--foreground-muted)]">{p.phrase}</span>
            </span>
          </li>
        ))}
      </ul>
      {suivante.peutAgir ? null : (
        <p className="text-xs text-[var(--foreground-muted)]">
          Étape suivante faite par {suivante.quiPeut}.
        </p>
      )}
      <Link
        href={suivante.href}
        className="text-sm font-medium text-[var(--accent)] underline-offset-2 hover:underline after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
      >
        {suivante.peutAgir ? `Continuer : ${suivante.label}` : 'Voir la mise en route'}
        <span className="sr-only">
          {' '}
          ({carte.faites} étapes faites sur {carte.total})
        </span>
      </Link>
    </div>
  );
}
