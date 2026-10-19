'use client';

// Échanges avec la DGI d'un document (ADR-0024 § 6 et § 9.3).
//
// `GET /sales/invoices/:id/dgi-exchanges` (`sales.read`) : chaque requête et
// chaque réponse, en ordre chronologique, corps compris — la DGI exige de les
// conserver. L'API n'y met JAMAIS d'en-tête ni de jeton ; `corpsLisible`
// masque malgré tout tout ce qui y ressemblerait (défense en profondeur).
// Chargé à l'ouverture seulement : la plupart des personnes n'en ont pas
// besoin.

import { useState } from 'react';

import { api } from '@/lib/api';

import { Alerte, BOUTON_PETIT } from '../../_components/form-ui';

import { formatInstant, type LigneEchange, lignesEchanges, messageFacture } from './invoice-model';

export function DgiExchanges({ invoiceId }: { invoiceId: string }): React.ReactElement {
  const [etat, setEtat] = useState<'ferme' | 'chargement' | 'pret' | 'erreur'>('ferme');
  const [lignes, setLignes] = useState<LigneEchange[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  function charger(): void {
    setEtat('chargement');
    setErreur(null);
    api
      .listDgiExchanges(invoiceId)
      .then((page) => {
        setLignes(lignesEchanges(page));
        setEtat('pret');
      })
      .catch((err: unknown) => {
        setErreur(messageFacture(err, 'Impossible de lire les échanges avec la DGI.'));
        setEtat('erreur');
      });
  }

  return (
    <details
      className="rounded-lg border border-[var(--border)] p-4"
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && etat === 'ferme') charger();
      }}
    >
      <summary className="cursor-pointer text-sm font-semibold">Échanges avec la DGI</summary>
      <div className="mt-3 flex flex-col gap-3" aria-live="polite">
        <p className="text-xs text-[var(--foreground-muted)]">
          Chaque requête envoyée à la DGI et chaque réponse reçue pour ce document, conservées comme
          l’exige la DGI. Aucun jeton n’y figure.
        </p>
        {etat === 'chargement' ? (
          <p className="text-sm text-[var(--foreground-muted)]">Lecture des échanges…</p>
        ) : null}
        {etat === 'erreur' ? (
          <Alerte
            action={
              <button type="button" className={BOUTON_PETIT} onClick={charger}>
                Réessayer
              </button>
            }
          >
            <p>{erreur}</p>
          </Alerte>
        ) : null}
        {etat === 'pret' && lignes.length === 0 ? (
          <p className="text-sm">Aucun échange avec la DGI pour ce document.</p>
        ) : null}
        {etat === 'pret' && lignes.length > 0 ? (
          <>
            <ol className="flex flex-col gap-2">
              {lignes.map((l) => (
                <li key={l.cle} className="rounded-md border border-[var(--border)] p-3 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{l.operation}</span>
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {l.sens} · {formatInstant(l.date)}
                    </span>
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-xs">
                    <span className="font-mono">{l.route}</span>
                    {l.resultat ? <span>{l.resultat}</span> : null}
                    {l.http ? <span>HTTP {l.http}</span> : null}
                    {l.duree ? <span>{l.duree}</span> : null}
                    {l.codeDgi ? (
                      <span>
                        Code DGI <span className="font-mono">{l.codeDgi}</span>
                      </span>
                    ) : null}
                  </p>
                  {l.corps ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs underline">
                        Voir le contenu échangé
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--surface)] p-2 font-mono text-xs">
                        {l.corps}
                      </pre>
                    </details>
                  ) : null}
                </li>
              ))}
            </ol>
            <button type="button" className={`${BOUTON_PETIT} self-start`} onClick={charger}>
              Actualiser
            </button>
          </>
        ) : null}
      </div>
    </details>
  );
}
