'use client';

// Liste des contrats — ADR-0050 § 9, lot V7. Abonnements : filtre « récurrents », pas
// d'onglet de plus. « + Contrat » (`sales.contract`) et « Réglages »
// (`sales.contract.approve`) ouvrent une fenêtre modale. Cartes entièrement cliquables.

import { buttonClasses, Select, TextInput } from '@lalanda/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  salesContractsApi,
  type SalesContractBillingKind,
  type SalesContractStatus,
  type SalesContractSummary,
} from '@/lib/api-sales-contracts';

import { Alerte, BOUTON, BOUTON_PETIT, Pastille } from '../../_components/form-ui';
import { formatMontant } from '../../_components/sales-model';
import { useAccesVentes } from '../../_components/sales-access';
import { formatJour } from '../../devis/_components/quote-model';

import { FenetreContrat } from './contract-form';
import {
  CONTRATS_BASE,
  FACTURATION_LABELS,
  FILTRES_CONTRATS,
  FILTRES_FACTURATION,
  libelleStatutContrat,
  messageEngagement,
  peutApprouverContrat,
  peutPreparerEngagement,
  tonContrat,
} from './contract-model';
import { FenetreReglages } from './contract-settings';

export function ContractList(): React.ReactElement {
  const router = useRouter();
  const { actions } = useAccesVentes();
  const preparer = peutPreparerEngagement(actions);
  const approuver = peutApprouverContrat(actions);
  const [statut, setStatut] = useState<SalesContractStatus | 'all'>('all');
  const [facturation, setFacturation] = useState<SalesContractBillingKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<SalesContractSummary[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fenetre, setFenetre] = useState<null | 'nouveau' | 'reglages'>(null);

  const filtres = {
    status: statut,
    ...(facturation === 'all' ? {} : { billingKind: facturation }),
    ...(q.trim() ? { q: q.trim() } : {}),
  };

  useEffect(() => {
    let annule = false;
    const t = setTimeout(() => {
      salesContractsApi
        .listContracts({
          status: statut,
          limit: 50,
          ...(facturation === 'all' ? {} : { billingKind: facturation }),
          ...(q.trim() ? { q: q.trim() } : {}),
        })
        .then((p) => {
          if (annule) return;
          setItems(p.items);
          setSuivante(p.nextCursor);
          setErreur(null);
        })
        .catch((err) => {
          if (!annule) setErreur(messageEngagement(err, 'Impossible de charger les contrats.'));
        });
    }, 200);
    return () => {
      annule = true;
      clearTimeout(t);
    };
  }, [statut, facturation, q]);

  async function plus(): Promise<void> {
    if (!suivante) return;
    try {
      const p = await salesContractsApi.listContracts({ ...filtres, limit: 50, cursor: suivante });
      setItems((x) => [...(x ?? []), ...p.items]);
      setSuivante(p.nextCursor);
    } catch (err) {
      setErreur(messageEngagement(err, 'Impossible de charger la suite.'));
    }
  }

  return (
    <section className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">Contrats et abonnements</h2>
          <p className="max-w-3xl text-sm text-[var(--foreground-muted)] max-sm:sr-only">
            Ce qui vous engage dans la durée : lignes, terme, reconduction, préavis, échéancier. Les
            brouillons d’échéance sont préparés pour vous ; vous les émettez un par un depuis
            l’écran des factures.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {approuver ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-haspopup="dialog"
              onClick={() => setFenetre('reglages')}
            >
              Réglages des alertes
            </button>
          ) : null}
          {preparer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'md')}
              aria-haspopup="dialog"
              onClick={() => setFenetre('nouveau')}
            >
              + Contrat
            </button>
          ) : null}
        </div>
      </div>
      <div role="search" className="flex flex-wrap gap-2">
        <TextInput
          type="search"
          aria-label="Rechercher un contrat"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Numéro CT…, client ou titre"
          maxLength={100}
          leading={<Search aria-hidden="true" className="h-4 w-4" />}
          className="min-w-0 flex-1 basis-60"
        />
        <Select<SalesContractStatus | 'all'>
          aria-label="Statut"
          value={statut}
          onChange={setStatut}
          options={FILTRES_CONTRATS.map((f) => ({ value: f.valeur, label: f.label }))}
          className="w-full sm:w-48"
        />
        <Select<SalesContractBillingKind | 'all'>
          aria-label="Facturation"
          value={facturation}
          onChange={setFacturation}
          options={FILTRES_FACTURATION.map((f) => ({ value: f.valeur, label: f.label }))}
          className="w-full sm:w-48"
        />
      </div>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {items === null ? (
        erreur ? null : (
          <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
            Chargement des contrats…
          </p>
        )
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--foreground-muted)]">
          Aucun contrat. Un contrat naît d’un devis accepté, ou se saisit ici.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link
                href={`${CONTRATS_BASE}/${encodeURIComponent(c.id)}`}
                className="flex h-full flex-col gap-2 rounded-xl border border-[var(--border)] p-4 transition hover:border-[var(--accent)]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{c.number}</span>
                  <span className="text-xs text-[var(--foreground-muted)]">v{c.version}</span>
                  <Pastille ton={tonContrat(c.status, c.derivedStatus)}>
                    {libelleStatutContrat(c)}
                  </Pastille>
                  <Pastille ton="neutre">{FACTURATION_LABELS[c.billingKind]}</Pastille>
                </span>
                <span className="text-sm font-medium">{c.title}</span>
                <span className="text-sm">{c.customerName ?? 'Client'}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  Début le {formatJour(c.startDate)}
                </span>
                <span className="mt-auto font-mono text-sm">
                  {c.total
                    ? `${formatMontant(c.total, c.currency)}${c.billingKind === 'recurring' ? ' par échéance (indicatif)' : ' (indicatif)'}`
                    : 'Calcul indisponible'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button type="button" onClick={() => void plus()} className={`${BOUTON} self-center`}>
          Afficher plus de contrats
        </button>
      ) : null}
      {fenetre === 'nouveau' ? (
        <FenetreContrat
          vue={null}
          onFermer={() => setFenetre(null)}
          onEnregistre={(v) => router.push(`${CONTRATS_BASE}/${encodeURIComponent(v.id)}`)}
        />
      ) : null}
      {fenetre === 'reglages' ? <FenetreReglages onFermer={() => setFenetre(null)} /> : null}
    </section>
  );
}
