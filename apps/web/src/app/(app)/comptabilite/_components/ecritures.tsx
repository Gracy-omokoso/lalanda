'use client';

// Écritures (ADR-0049 § 13) : liste filtrable par journal, période, compte et pièce
// (filtres en corps `POST`, § 11) ; détail avec la pièce, la règle et sa version ;
// « À comptabiliser ». Tout vient de l'API ; une route pas encore livrée (404) affiche
// « bientôt disponible ».

import { Badge, Button, Modal } from '@lalanda/ui';
import { Inbox, NotebookPen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { accountingApi, type AccountingEntryView } from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { useAccesCompta } from './comptabilite-access';
import { formatJour, formatMontant, formatValeur, moisDe } from './comptabilite-model';
import {
  Bandeau,
  CarteVide,
  Chargement,
  ChoixMois,
  EchecLecture,
  Panneau,
  Terme,
} from './comptabilite-ui';
import {
  corpsRecherche,
  lienPiece,
  numeroEcriture,
  origineEcriture,
  type FiltresEcritures,
} from './ecritures-model';
import { LIBELLES_EN_ATTENTE, LIBELLES_SOURCE, LIBELLES_STATUT_ECRITURE } from './libelles';
import { useLecture } from './use-lecture';

function Detail({
  ecriture,
  onClose,
}: {
  ecriture: AccountingEntryView;
  onClose: () => void;
}): React.ReactElement {
  const { actions } = useAccesCompta();
  const lien = lienPiece(ecriture.source, actions);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={numeroEcriture(ecriture)}
      description={`${formatJour(ecriture.date)} — ${LIBELLES_STATUT_ECRITURE[ecriture.status]}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        {ecriture.source ? (
          <p>
            Pièce : {LIBELLES_SOURCE[ecriture.source.kind]}
            {ecriture.source.number ? ` ${ecriture.source.number}` : ''} du{' '}
            {formatJour(ecriture.source.date)}
            {ecriture.source.partyName ? ` — ${ecriture.source.partyName}` : ''}.{' '}
            {lien ? (
              <Link href={lien} className="underline underline-offset-2">
                Ouvrir la pièce
              </Link>
            ) : null}
          </p>
        ) : null}
        <p className="text-[var(--foreground-muted)]">{origineEcriture(ecriture)}</p>
        {ecriture.reversalOf ? <Badge tone="neutral">Contre-passation d’une écriture</Badge> : null}
        {ecriture.reversedBy ? <Badge tone="warning">Contre-passée</Badge> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem]">
            <thead className="text-left text-xs text-[var(--foreground-muted)]">
              <tr>
                <th className="py-1.5 pr-3 font-medium">Compte</th>
                <th className="py-1.5 pr-3 font-medium">Libellé</th>
                <th className="py-1.5 pr-3 text-right font-medium">Débit</th>
                <th className="py-1.5 pr-3 text-right font-medium">Crédit</th>
                <th className="py-1.5 text-right font-medium">Montant de la pièce</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {ecriture.lines.map((l, i) => (
                <tr key={`${l.accountNumber}-${i}`}>
                  <td className="py-1.5 pr-3 font-mono">
                    {l.accountNumber}
                    {l.auxiliaryAccountNumber ? ` / ${l.auxiliaryAccountNumber}` : ''}
                    {l.accountLabel ? (
                      <span className="block font-sans text-xs text-[var(--foreground-muted)]">
                        {l.accountLabel}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3">{l.label}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {l.debit ? formatMontant(l.debit) : ''}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {l.credit ? formatMontant(l.credit) : ''}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">
                    {formatValeur(l.amount, l.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export function Ecritures(): React.ReactElement {
  const { mode } = useAccesCompta();
  const [filtres, setFiltres] = useState<FiltresEcritures>({
    journal: '',
    mois: moisDe(new Date()),
    compte: '',
    piece: '',
  });
  const [ouverte, setOuverte] = useState<AccountingEntryView | null>(null);
  const journaux = useLecture(() => accountingApi.listJournals().then((r) => r.items), mode);
  const page = useLecture(
    () => accountingApi.searchEntries(corpsRecherche(filtres)),
    `${JSON.stringify(filtres)}-${String(mode)}`,
  );
  const aComptabiliser = useLecture(() => accountingApi.listPending(), mode);

  const maj = (k: keyof FiltresEcritures, v: string): void => setFiltres((f) => ({ ...f, [k]: v }));

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={NotebookPen}
        titre={<Terme terme="ecriture">Écritures</Terme>}
        sousTitre="Chaque écriture est reliée à sa pièce. Une écriture validée ne se supprime jamais : elle se contre-passe."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label
            htmlFor="compta-filtre-journal"
            className="flex flex-col gap-1 text-sm font-medium"
          >
            Journal
            <select
              id="compta-filtre-journal"
              className={`${CHAMP} sm:w-48`}
              value={filtres.journal}
              onChange={(e) => maj('journal', e.target.value)}
            >
              <option value="">Tous les journaux</option>
              {journaux?.ok
                ? journaux.valeur.map((j) => (
                    <option key={j.code} value={j.code}>
                      {j.code} — {j.label}
                    </option>
                  ))
                : null}
            </select>
          </label>
          <ChoixMois
            id="compta-filtre-mois"
            libelle="Mois"
            valeur={filtres.mois}
            onChange={(v) => maj('mois', v)}
          />
          <label htmlFor="compta-filtre-compte" className="flex flex-col gap-1 text-sm font-medium">
            Compte
            <input
              id="compta-filtre-compte"
              inputMode="numeric"
              className={`${CHAMP} sm:w-40`}
              value={filtres.compte}
              onChange={(e) => maj('compte', e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label htmlFor="compta-filtre-piece" className="flex flex-col gap-1 text-sm font-medium">
            Pièce
            <input
              id="compta-filtre-piece"
              className={`${CHAMP} sm:w-48`}
              placeholder="Numéro de la pièce"
              value={filtres.piece}
              onChange={(e) => maj('piece', e.target.value)}
            />
          </label>
        </div>
      </Bandeau>

      <Panneau titre="Liste des écritures" icone={NotebookPen} id="compta-ecritures">
        {mode === 'simulation' ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            En simulation, les écritures sont calculées à la volée et ne portent aucun numéro.
          </p>
        ) : null}
        {page === null ? (
          <Chargement />
        ) : !page.ok ? (
          <EchecLecture erreur={page.erreur} repli="Les écritures sont illisibles." />
        ) : page.valeur.items.length === 0 ? (
          <CarteVide>Aucune écriture pour ces critères.</CarteVide>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)]">
            {page.valeur.items.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOuverte(e)}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-left text-sm hover:bg-[var(--surface-muted)]"
                >
                  <span className="w-28 shrink-0 tabular-nums text-[var(--foreground-muted)]">
                    {formatJour(e.date)}
                  </span>
                  <span className="font-medium">{numeroEcriture(e)}</span>
                  <span className="min-w-0 flex-1 break-words">
                    {e.label ?? (e.source ? LIBELLES_SOURCE[e.source.kind] : '')}
                    {e.source?.number ? ` — ${e.source.number}` : ''}
                  </span>
                  {e.suspense ? <Badge tone="warning">Compte d’attente</Badge> : null}
                  <Badge tone={e.status === 'posted' ? 'success' : 'neutral'}>
                    {LIBELLES_STATUT_ECRITURE[e.status]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        {page?.ok && page.valeur.nextCursor !== null ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Les 50 premières écritures sont affichées : précisez les filtres pour voir les autres.
          </p>
        ) : null}
        <p className="text-sm text-[var(--foreground-muted)]">
          Saisie d’une opération diverse, validation et contre-passation : bientôt disponibles.
        </p>
      </Panneau>

      <Panneau titre="À comptabiliser" icone={Inbox} id="compta-a-comptabiliser">
        {aComptabiliser === null ? (
          <Chargement />
        ) : !aComptabiliser.ok ? (
          <EchecLecture erreur={aComptabiliser.erreur} repli="La liste est illisible." />
        ) : aComptabiliser.valeur.items.length === 0 ? (
          <CarteVide>Toutes les pièces sont passées en écritures.</CarteVide>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {aComptabiliser.valeur.items.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2">
                <span className="font-medium">
                  {LIBELLES_SOURCE[p.source.kind]}
                  {p.source.number ? ` ${p.source.number}` : ''}
                </span>
                <span className="text-[var(--foreground-muted)]">{formatJour(p.source.date)}</span>
                <Badge tone="warning">{LIBELLES_EN_ATTENTE[p.reason]}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panneau>

      {ouverte ? <Detail ecriture={ouverte} onClose={() => setOuverte(null)} /> : null}
    </section>
  );
}
