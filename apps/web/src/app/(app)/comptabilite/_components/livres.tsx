'use client';

// Grand livre, balance, clients et fournisseurs (ADR-0049 § 6.11, § 13). Critères en
// corps `POST` (§ 11). Montants en monnaie de tenue, montant de la pièce dans sa devise
// à côté ; réserves en tête ; contrôle débits = crédits tel que l'API le rend. Aucun
// total n'est calculé ici.

import {
  ACCOUNTING_TO_CONFIRM_LABEL,
  type AccountingAuxiliaryKind,
} from '@lalanda/shared/accounting';
import { Badge } from '@lalanda/ui';
import { BookOpen, Scale, Users } from 'lucide-react';
import { useState } from 'react';

import {
  accountingApi,
  type AccountingAuxiliaryBalanceView,
  type AccountingTrialBalanceView,
} from '@/lib/api-accounting';

import { CHAMP } from '../../ventes/_components/form-ui';

import { useAccesCompta } from './comptabilite-access';
import {
  bornesDuMois,
  formatJour,
  formatMontant,
  formatSolde,
  formatValeur,
  moisDe,
  type Lecture,
} from './comptabilite-model';
import {
  AConfirmer,
  Bandeau,
  CarteVide,
  Chargement,
  ChoixMois,
  EchecLecture,
  Panneau,
  Reserves,
  Terme,
} from './comptabilite-ui';
import { useLecture } from './use-lecture';

function critere(
  mois: string,
  compte = '',
): Promise<{ from: string; to: string; accountNumber?: string }> {
  const b = bornesDuMois(mois);
  if (b === null) return Promise.reject(new Error('Choisissez un mois.'));
  return Promise.resolve({ ...b, ...(compte ? { accountNumber: compte } : {}) });
}

function EnTeteReserves({
  l,
}: {
  l: Lecture<{ reserves: AccountingTrialBalanceView['reserves'] }> | null;
}): React.ReactElement | null {
  if (l === null || !l.ok) return null;
  return (
    <Panneau titre={<Terme terme="reserve">Réserves</Terme>} id="compta-livre-reserves">
      <Reserves reserves={l.valeur.reserves} />
    </Panneau>
  );
}

function TableBalance({ b }: { b: AccountingTrialBalanceView }): React.ReactElement {
  if (b.rows.length === 0) return <CarteVide>Aucun compte mouvementé sur cette période.</CarteVide>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <thead className="text-left text-xs text-[var(--foreground-muted)]">
            <tr>
              <th className="py-2 pr-3 font-medium">Compte</th>
              <th className="py-2 pr-3 text-right font-medium">À-nouveaux débit</th>
              <th className="py-2 pr-3 text-right font-medium">À-nouveaux crédit</th>
              <th className="py-2 pr-3 text-right font-medium">Mouvements débit</th>
              <th className="py-2 pr-3 text-right font-medium">Mouvements crédit</th>
              <th className="py-2 pr-3 text-right font-medium">Solde débiteur</th>
              <th className="py-2 text-right font-medium">Solde créditeur</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] tabular-nums">
            {b.rows.map((r) => (
              <tr key={r.accountNumber}>
                <td className="py-1.5 pr-3">
                  <span className="font-mono">{r.accountNumber}</span> {r.label ?? ''}
                  {r.confirmation === 'to_confirm' ? (
                    <span className="ml-1">
                      <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} />
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 pr-3 text-right">{formatMontant(r.openingDebit)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMontant(r.openingCredit)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMontant(r.periodDebit)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMontant(r.periodCredit)}</td>
                <td className="py-1.5 pr-3 text-right">{formatMontant(r.closingDebit)}</td>
                <td className="py-1.5 text-right">{formatMontant(r.closingCredit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        Mouvements au débit : <strong>{formatValeur(b.totals.periodDebit, b.bookCurrency)}</strong>{' '}
        · au crédit : <strong>{formatValeur(b.totals.periodCredit, b.bookCurrency)}</strong>
        <Badge tone={b.balanced ? 'success' : 'danger'}>
          {b.balanced ? 'Équilibrée' : 'Déséquilibrée'}
        </Badge>
      </p>
    </>
  );
}

function TableAuxiliaire({ b }: { b: AccountingAuxiliaryBalanceView }): React.ReactElement {
  const lignes = b.groups.flatMap((g) => g.rows);
  if (lignes.length === 0) return <CarteVide>Aucun compte mouvementé sur cette période.</CarteVide>;
  return (
    <div className="flex flex-col gap-4">
      {b.groups.map((g) => (
        <div key={g.collectiveAccountNumber} className="flex flex-col gap-2">
          <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            Compte collectif <span className="font-mono">{g.collectiveAccountNumber}</span>
            <span className="ml-auto font-normal text-[var(--foreground-muted)]">
              Solde {formatSolde(g.closingBalance)}
            </span>
          </h4>
          {g.withoutAuxiliaryBalance !== '0.00' ? (
            <p className="text-sm text-[var(--warn)]">
              Montant porté sans compte de tiers : {formatSolde(g.withoutAuxiliaryBalance)}. Il est
              signalé, jamais réparti.
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-sm">
              <thead className="text-left text-xs text-[var(--foreground-muted)]">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Tiers</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Solde d’ouverture</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Débit</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Crédit</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Solde</th>
                  <th className="py-1.5 text-right font-medium">Non lettrées</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)] tabular-nums">
                {g.rows.map((r) => (
                  <tr key={r.auxiliaryAccountNumber}>
                    <td className="py-1.5 pr-3">
                      <span className="font-mono">{r.auxiliaryAccountNumber}</span> {r.label ?? ''}
                      {r.byCurrency.some((c) => c.currency !== b.bookCurrency) ? (
                        <span className="block text-xs text-[var(--foreground-muted)]">
                          {r.byCurrency.map((c) => formatValeur(c.balance, c.currency)).join(' · ')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{formatSolde(r.openingBalance)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatMontant(r.periodDebit)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatMontant(r.periodCredit)}</td>
                    <td className="py-1.5 pr-3 text-right">{formatSolde(r.closingBalance)}</td>
                    <td className="py-1.5 text-right">{r.unletteredLineCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

export function GrandLivre(): React.ReactElement {
  const { mode } = useAccesCompta();
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const [compte, setCompte] = useState('');
  const l = useLecture(
    () => critere(mois, compte).then((c) => accountingApi.ledger(c)),
    `${mois}-${compte}-${String(mode)}`,
  );
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={BookOpen}
        titre={<Terme terme="grandLivre">Grand livre</Terme>}
        sousTitre="Compte par compte, les écritures validées et le solde qui en résulte."
      >
        <div className="flex flex-wrap items-end gap-3">
          <ChoixMois id="compta-gl-mois" libelle="Mois" valeur={mois} onChange={setMois} />
          <label htmlFor="compta-gl-compte" className="flex flex-col gap-1 text-sm font-medium">
            Compte (facultatif)
            <input
              id="compta-gl-compte"
              inputMode="numeric"
              className={`${CHAMP} sm:w-40`}
              value={compte}
              onChange={(e) => setCompte(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        </div>
      </Bandeau>
      <EnTeteReserves l={l} />
      <Panneau titre="Comptes" icone={BookOpen} id="compta-gl">
        {l === null ? (
          <Chargement />
        ) : !l.ok ? (
          <EchecLecture erreur={l.erreur} repli="Le grand livre est illisible." />
        ) : l.valeur.accounts.length === 0 ? (
          <CarteVide>Aucun compte mouvementé sur cette période.</CarteVide>
        ) : (
          <div className="flex flex-col gap-5">
            {l.valeur.accounts.map((c) => (
              <div key={c.accountNumber} className="flex flex-col gap-2">
                <h4 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="font-mono">{c.accountNumber}</span> {c.label ?? ''}
                  {c.confirmation === 'to_confirm' ? (
                    <AConfirmer texte={ACCOUNTING_TO_CONFIRM_LABEL} />
                  ) : null}
                  <span className="ml-auto font-normal text-[var(--foreground-muted)]">
                    Solde d’ouverture {formatSolde(c.openingBalance)} · de clôture{' '}
                    {formatSolde(c.closingBalance)}
                  </span>
                </h4>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[44rem] text-sm">
                    <thead className="text-left text-xs text-[var(--foreground-muted)]">
                      <tr>
                        <th className="py-1.5 pr-3 font-medium">Date</th>
                        <th className="py-1.5 pr-3 font-medium">Journal</th>
                        <th className="py-1.5 pr-3 font-medium">Libellé</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Débit</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Crédit</th>
                        <th className="py-1.5 pr-3 text-right font-medium">Solde</th>
                        <th className="py-1.5 text-right font-medium">Devise de la pièce</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)] tabular-nums">
                      {c.lines.map((ln) => (
                        <tr key={ln.ref}>
                          <td className="py-1.5 pr-3 whitespace-nowrap">{formatJour(ln.date)}</td>
                          <td className="py-1.5 pr-3 font-mono">{ln.journalCode}</td>
                          <td className="py-1.5 pr-3">
                            {ln.label}
                            {ln.letteringCode ? (
                              <Badge tone="neutral">Lettrée {ln.letteringCode}</Badge>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-3 text-right">{formatMontant(ln.debit)}</td>
                          <td className="py-1.5 pr-3 text-right">{formatMontant(ln.credit)}</td>
                          <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                            {formatSolde(ln.balance)}
                          </td>
                          <td className="py-1.5 text-right whitespace-nowrap">
                            {ln.currency !== l.valeur.bookCurrency
                              ? formatValeur(ln.amount, ln.currency)
                              : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panneau>
    </section>
  );
}

export function Balance(): React.ReactElement {
  const { mode } = useAccesCompta();
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const l = useLecture(
    () => critere(mois).then((c) => accountingApi.trialBalance(c)),
    `${mois}-${String(mode)}`,
  );
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Scale}
        titre={<Terme terme="balance">Balance</Terme>}
        sousTitre="Chaque compte : ce qu’il avait au début, ce qui a bougé, ce qu’il a à la fin."
      >
        <ChoixMois id="compta-bal-mois" libelle="Mois" valeur={mois} onChange={setMois} />
      </Bandeau>
      <EnTeteReserves l={l} />
      <Panneau titre="Balance générale" icone={Scale} id="compta-balance">
        {l === null ? (
          <Chargement />
        ) : !l.ok ? (
          <EchecLecture erreur={l.erreur} repli="La balance est illisible." />
        ) : (
          <TableBalance b={l.valeur} />
        )}
      </Panneau>
    </section>
  );
}

export function Tiers(): React.ReactElement {
  const { mode } = useAccesCompta();
  const [mois, setMois] = useState(() => moisDe(new Date()));
  const [nature, setNature] = useState<AccountingAuxiliaryKind>('customer');
  const l = useLecture(
    () =>
      critere(mois).then((c) => accountingApi.auxiliaryBalance({ ...c, auxiliaryKind: nature })),
    `${mois}-${nature}-${String(mode)}`,
  );
  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Users}
        titre={<Terme terme="auxiliaire">Clients et fournisseurs</Terme>}
        sousTitre="Un compte par client et par fournisseur, et le lettrage de leurs factures et règlements."
      >
        <div className="flex flex-wrap items-end gap-3">
          <ChoixMois id="compta-tiers-mois" libelle="Mois" valeur={mois} onChange={setMois} />
          <fieldset className="flex gap-2">
            <legend className="sr-only">Nature des comptes</legend>
            {(['customer', 'supplier'] as const).map((k) => (
              <label
                key={k}
                className={`cursor-pointer rounded-[var(--radius-sm)] border px-3 py-2 text-sm font-medium ${nature === k ? 'border-[var(--module-run)]' : 'border-[var(--border)]'}`}
              >
                <input
                  type="radio"
                  name="nature-tiers"
                  className="sr-only"
                  checked={nature === k}
                  onChange={() => setNature(k)}
                />
                {k === 'customer' ? 'Clients' : 'Fournisseurs'}
              </label>
            ))}
          </fieldset>
        </div>
      </Bandeau>
      <EnTeteReserves l={l} />
      <Panneau
        titre={nature === 'customer' ? 'Balance des clients' : 'Balance des fournisseurs'}
        icone={Users}
        id="compta-tiers"
      >
        {l === null ? (
          <Chargement />
        ) : !l.ok ? (
          <EchecLecture erreur={l.erreur} repli="La balance auxiliaire est illisible." />
        ) : (
          <TableAuxiliaire b={l.valeur} />
        )}
      </Panneau>
      <Panneau titre={<Terme terme="lettrage">Lettrage</Terme>} id="compta-lettrage">
        <p className="text-sm text-[var(--foreground-muted)]">
          Lalanda lettre seul un encaissement ou un paiement qui cite sa facture. Le lettrage par
          sélection de lignes d’un même compte arrive avec une prochaine livraison.
        </p>
      </Panneau>
    </section>
  );
}
