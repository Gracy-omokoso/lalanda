'use client';

// Validations en attente — ADR-0044 § 3.2 et § 8 : les demandes que l'API juge
// approuvables par l'utilisateur (`GET /purchases/approvals/pending`). On
// approuve ou refuse depuis la fiche, qui montre lignes et taxes déclarées.

import { Badge } from '@lalanda/ui';
import { ClipboardCheck } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { purchasesApi, type PurchaseOrderView } from '@/lib/api-purchases';

import { Bandeau, PhraseSection } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { useAccesAchats } from './achats-access';
import { lienCommande, messageAchats, peutApprouverAchats } from './achats-model';
import {
  PHRASE_APPROBATEUR_UNIQUE,
  PHRASE_AUCUNE_VALIDATION,
  PHRASE_SANS_DROIT_VALIDATION,
  ligneValidation,
} from './validations-model';

export function Validations(): React.ReactElement {
  const { actions, membres, moi, etat } = useAccesAchats();
  const approuver = peutApprouverAchats(actions);
  const [items, setItems] = useState<PurchaseOrderView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback((cursor: string | null) => {
    purchasesApi
      .listPendingApprovals({ limit: 50, ...(cursor ? { cursor } : {}) })
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(messageAchats(err, 'Impossible de charger les demandes à approuver.'));
      });
  }, []);

  useEffect(() => {
    if (etat === 'pret' && approuver) charger(null);
  }, [etat, approuver, charger]);

  const lignes = (items ?? []).map((o) => ligneValidation(o, membres, moi));

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ClipboardCheck}
        titre="À approuver"
        sousTitre="Les demandes d’achat qui attendent votre décision. Vos propres demandes n’y figurent pas, sauf si vous êtes le seul approbateur."
      />

      {etat === 'pret' && !approuver ? (
        <PhraseSection>{PHRASE_SANS_DROIT_VALIDATION}</PhraseSection>
      ) : erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : items === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement…
        </p>
      ) : lignes.length === 0 ? (
        <p className="rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          {PHRASE_AUCUNE_VALIDATION}
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {lignes.map((l) => (
            <li key={l.id}>
              <Link
                href={lienCommande(l.id)}
                className="flex h-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">{l.titre}</span>
                  <Badge tone="warning">Approbation</Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {l.numero} · {l.fournisseur}
                </span>
                <strong className="font-display text-lg tabular-nums">{l.montant}</strong>
                <span className="text-xs">
                  Demandé par {l.demandeur} · {l.depuis}
                </span>
                {l.progression ? (
                  <span className="text-xs text-[var(--foreground-muted)]">{l.progression}</span>
                ) : null}
                {l.propreDemande ? (
                  <span className="text-xs text-[var(--foreground-muted)]">
                    {PHRASE_APPROBATEUR_UNIQUE}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(suivante)}
        >
          Afficher plus de demandes
        </button>
      ) : null}
    </section>
  );
}
