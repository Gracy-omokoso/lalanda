'use client';

// Compte rendu d'une réception enregistrée : statut de la commande et reste à
// recevoir par ligne, TELS QUE RENDUS par l'API (moteur `orderReceptionStatus`).

import { Badge } from '@lalanda/ui';
import { PackageCheck } from 'lucide-react';
import Link from 'next/link';

import type {
  PurchaseOrderDetailView,
  PurchaseReceptionWriteResult,
} from '@/lib/api-purchases-payables';

import { BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { LIBELLES_STATUT, lienReception, tonStatut } from './achats-model';
import { phrasesResultat } from './receptions-model';

export function ResultatReception({
  resultat,
  commande,
  avertissement,
  onFermer,
}: {
  resultat: PurchaseReceptionWriteResult;
  commande: Pick<PurchaseOrderDetailView, 'lines'>;
  avertissement: string | null;
  onFermer: () => void;
}): React.ReactElement {
  const libelles = new Map(commande.lines.map((l) => [l.id, l.label]));
  const lignes = phrasesResultat(resultat, libelles);
  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <PackageCheck aria-hidden="true" className="h-4 w-4 text-[var(--module-run)]" />
          Réception enregistrée — commande désormais :
          <Badge tone={tonStatut(resultat.order.status)}>
            {LIBELLES_STATUT[resultat.order.status]}
          </Badge>
        </p>
        <span className="flex gap-2">
          <Link href={lienReception(resultat.reception.id)} className={BOUTON_PETIT}>
            Ouvrir la réception
          </Link>
          <button type="button" className={BOUTON_PETIT} onClick={onFermer}>
            Fermer
          </button>
        </span>
      </div>
      {lignes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm">
          {lignes.map((l) => (
            <li key={l.label} className="flex flex-wrap justify-between gap-2">
              <span className="break-words">{l.label}</span>
              <span className={l.excedent ? 'font-medium text-[var(--danger)]' : ''}>
                {l.phrase}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {avertissement ? <p className="text-sm text-[var(--danger)]">{avertissement}</p> : null}
    </section>
  );
}
