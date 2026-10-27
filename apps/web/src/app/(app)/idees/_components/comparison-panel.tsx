'use client';

// Validation — comparaison des idées actives (ADR-0036 § 1, § 2) : la matrice
// critères × idées et le classement du MOTEUR. Une idée au score indisponible
// n'a pas de rang ; elle n'est jamais classée devant une idée notée.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { ideaLabApi, type IdeaListResponse } from '@/lib/idea-lab-api';

import { Bloc, Chargement, EtatVide, Erreur, Pastille } from '../../croissance/_components/grow-ui';
import { messageErreur, tonNiveau } from './idea-model';

export function ComparisonPanel(): React.ReactElement {
  const [vue, setVue] = useState<IdeaListResponse | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    setErreur(null);
    try {
      setVue(await ideaLabApi.list());
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger la comparaison.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur) return <Erreur message={erreur} onRetry={() => void charger()} />;
  if (!vue) return <Chargement />;

  const { grid, comparison } = vue;
  return (
    <div className="flex flex-col gap-8">
      <Bloc titre="Comparer vos idées">
        {comparison.length === 0 ? (
          <EtatVide titre="Aucune idée à comparer">
            <p>
              <Link href="/idees" className="underline">
                Créez une idée
              </Link>
              , puis notez-la sur la grille de validation.
            </p>
          </EtatVide>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <caption className="sr-only">
                Notes de 0 à 4 par critère ; un tiret signale un critère non noté avec une preuve.
              </caption>
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--foreground-muted)]">
                  <th scope="col" className="py-2 pr-3">
                    Rang
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Idée
                  </th>
                  <th scope="col" className="py-2 pr-3">
                    Score
                  </th>
                  {grid.criteres.map((c) => (
                    <th key={c.id} scope="col" className="py-2 pr-3" title={c.libelle}>
                      {c.libelle} <span className="font-normal">({c.poids})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] align-top">
                    <td className="fig py-2 pr-3">{r.rang ?? '—'}</td>
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      <Link
                        href={`/idees/${r.id}/validation`}
                        className="hover:text-[var(--accent)]"
                      >
                        {r.titre}
                      </Link>
                    </th>
                    <td className="py-2 pr-3">
                      {r.score === null ? (
                        <Pastille ton="neutre">Indisponible</Pastille>
                      ) : (
                        <Pastille ton={tonNiveau(r.niveau)}>{r.score} / 100</Pastille>
                      )}
                      <div className="mt-1 text-xs text-[var(--foreground-muted)]">
                        {r.poidsRenseigne} % du poids noté
                      </div>
                    </td>
                    {grid.criteres.map((c) => (
                      <td key={c.id} className="fig py-2 pr-3">
                        {r.notes[c.id] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloc>

      <Bloc titre={`La grille (${grid.version})`}>
        <div className="doc-card flex flex-col gap-3 p-4 text-sm">
          <p>
            Chaque critère se note de 0 à 4 <strong>avec une preuve</strong>. Le score, calculé par
            le moteur de Lalanda, est la moyenne des notes pondérée par les poids, ramenée sur 100.
            Il n’est publié qu’à partir de {grid.criteresMin} critères notés couvrant au moins{' '}
            {grid.couvertureMinPct} % du poids. Les poids sont une proposition de l’équipe, en
            attente de validation.
          </p>
          <ul className="flex flex-col gap-1">
            {grid.criteres.map((c) => (
              <li key={c.id}>
                <span className="font-medium">
                  {c.libelle} — poids {c.poids}
                </span>
                <span className="text-[var(--foreground-muted)]">
                  {' '}
                  · preuve : {c.preuveAttendue}
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]">
            {grid.notes.map((n) => (
              <li key={n.note}>
                <span className="fig font-medium">{n.note}</span> : {n.libelle}
              </li>
            ))}
          </ul>
        </div>
      </Bloc>
    </div>
  );
}
