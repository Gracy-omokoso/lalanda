'use client';

// Module « Finances du site » de la console (ADR-0053 § 6.8 — lot P7).
//
// Affiche le rapport du moteur (`platform-revenue`) servi par `GET /admin/finance` :
// encaissements constatés par mois, offre et moyen, PAR DEVISE ; paiements en ligne
// comptés sans montant ; revenu récurrent déclaré ; file des demandes manuelles.
// L'export CSV (finance et super-administrateur) est journalisé par l'API.

import { Field, MonthPicker } from '@lalanda/ui';
import { useCallback, useEffect, useState } from 'react';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Compteur, Vide } from './admin-chrome';
import { messageErreur } from './admin-model';
import {
  chargerFinances,
  erreurPeriode,
  formaterMontant,
  formaterMontants,
  LIBELLES_FINANCES as L,
  libelleFournisseur,
  libelleMois,
  libelleMoyen,
  libelleOffre,
  nombreDeDepots,
  telechargerExportFinances,
  type FinancesView,
  type MontantDevise,
} from './finances-model';

const BOUTON =
  'rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40';

export function FinancesPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const peutExporter = acces.actions.includes('platform.finance.export');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [vue, setVue] = useState<FinancesView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [export_, setExport] = useState<'repos' | 'encours'>('repos');

  const charger = useCallback(async (f: string, t: string): Promise<void> => {
    try {
      const v = await chargerFinances(f, t);
      setVue(v);
      setFrom(v.period.from);
      setTo(v.period.to);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger les finances du site.'));
    }
  }, []);

  useEffect(() => {
    void charger('', '');
  }, [charger]);

  const periodeInvalide = from || to ? erreurPeriode(from, to) : null;

  async function exporter(): Promise<void> {
    setExport('encours');
    try {
      const { blob, filename } = await telechargerExportFinances(from, to);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErreur(messageErreur(err, 'Export impossible.'));
    } finally {
      setExport('repos');
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!periodeInvalide) void charger(from, to);
        }}
      >
        {/* ADR-0074, décision n° 6 : mêmes valeurs AAAA-MM que les anciens champs natifs. */}
        <Field id="finances-du" label="Du mois" size="sm" className="w-44">
          <MonthPicker value={from} onChange={setFrom} />
        </Field>
        <Field id="finances-au" label="au mois" size="sm" className="w-44">
          <MonthPicker value={to} onChange={setTo} />
        </Field>
        <button type="submit" className={BOUTON} disabled={Boolean(periodeInvalide)}>
          Afficher
        </button>
        {peutExporter ? (
          <button
            type="button"
            className={BOUTON}
            disabled={Boolean(periodeInvalide) || export_ === 'encours' || !vue}
            onClick={() => void exporter()}
            title={L.aideExport}
          >
            {export_ === 'encours' ? 'Export…' : L.export}
          </button>
        ) : null}
      </form>
      {periodeInvalide ? <Bandeau ton="attention">{periodeInvalide}</Bandeau> : null}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
      {!vue ? erreur ? null : <Vide>Chargement des finances…</Vide> : <Rapport vue={vue} />}
    </div>
  );
}

function Section({
  titre,
  aide,
  children,
}: {
  titre: string;
  aide?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-display text-lg font-bold tracking-tight">{titre}</h2>
      {aide ? <p className="max-w-3xl text-sm text-[var(--foreground-muted)]">{aide}</p> : null}
      {children}
    </section>
  );
}

function Tableau({
  lignes,
}: {
  lignes: ReadonlyArray<{ cle: string; libelle: string; montants: MontantDevise[] }>;
}): React.ReactElement {
  if (lignes.length === 0) return <Vide>Aucun encaissement sur la période.</Vide>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[var(--border)] text-left text-[var(--foreground-muted)]">
          <th className="py-1.5 pr-4 font-medium" />
          <th className="py-1.5 pr-4 text-right font-medium">Dépôts</th>
          <th className="py-1.5 text-right font-medium">Montant</th>
        </tr>
      </thead>
      <tbody>
        {lignes.map((l) => (
          <tr key={l.cle} className="border-b border-[var(--border)]">
            <td className="py-1.5 pr-4">{l.libelle}</td>
            <td className="py-1.5 pr-4 text-right font-mono tabular-nums">
              {nombreDeDepots(l.montants)}
            </td>
            <td className="py-1.5 text-right font-mono tabular-nums">
              {formaterMontants(l.montants)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Rapport({ vue }: { vue: FinancesView }): React.ReactElement {
  const r = vue.receipts;
  return (
    <div className="flex flex-col gap-8">
      <Section titre={L.encaissements} aide={L.aideEncaissements}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {r.total.length === 0 ? (
            <Compteur
              libelle={`${libelleMois(vue.period.from)} – ${libelleMois(vue.period.to)}`}
              valeur="—"
              precision="aucun dépôt confirmé"
            />
          ) : (
            r.total.map((t) => (
              <Compteur
                key={t.currency}
                libelle={`${libelleMois(vue.period.from)} – ${libelleMois(vue.period.to)}`}
                valeur={formaterMontant(t.totalCents, t.currency)}
                precision={`${t.count} dépôt(s) confirmé(s)`}
              />
            ))
          )}
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section titre={L.parMois}>
          <Tableau
            lignes={r.byMonth.map((m) => ({
              cle: m.month,
              libelle: libelleMois(m.month),
              montants: m.byCurrency,
            }))}
          />
        </Section>
        <div className="flex flex-col gap-6">
          <Section titre={L.parOffre}>
            <Tableau
              lignes={r.byPlan.map((p) => ({
                cle: p.plan,
                libelle: libelleOffre(p.plan),
                montants: p.byCurrency,
              }))}
            />
          </Section>
          <Section titre={L.parMoyen}>
            <Tableau
              lignes={r.byMethod.map((m) => ({
                cle: m.method,
                libelle: libelleMoyen(m.method),
                montants: m.byCurrency,
              }))}
            />
          </Section>
        </div>
      </div>

      <Section titre={L.rappels} aide={L.aideRappels}>
        {vue.providerEventsWithoutAmount.length === 0 ? (
          <Vide>Aucun paiement en ligne reçu sur la période.</Vide>
        ) : (
          <ul className="text-sm">
            {vue.providerEventsWithoutAmount.map((e) => (
              <li key={e.provider}>
                {libelleFournisseur(e.provider)} : {e.count} paiement(s)
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section titre={L.recurrent} aide={L.aideRecurrent}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vue.declaredRecurring.length === 0 ? (
            <Compteur
              libelle="Équivalent mensuel"
              valeur="—"
              precision="aucun abonnement payé actif"
            />
          ) : (
            vue.declaredRecurring.map((d) => (
              <Compteur
                key={d.currency}
                libelle="Équivalent mensuel"
                valeur={formaterMontant(d.monthlyEquivalentCents, d.currency)}
                precision={`${d.subscriptions} abonnement(s) actif(s) payé(s)`}
              />
            ))
          )}
          <Compteur
            libelle="Non retenus"
            valeur={
              vue.recurringExclusions.neverPaid + vue.recurringExclusions.withoutPublishedTariff
            }
            precision={`jamais payés (octrois) : ${vue.recurringExclusions.neverPaid} · sans tarif publié : ${vue.recurringExclusions.withoutPublishedTariff}`}
          />
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section titre={L.file}>
          <table className="w-full text-sm">
            <tbody>
              {(
                [
                  [L.enAttente, vue.manualQueue.pending],
                  [L.expirees, vue.manualQueue.expired],
                  [L.refusees, vue.manualQueue.rejected],
                ] as const
              ).map(([libelle, montants]) => (
                <tr key={libelle} className="border-b border-[var(--border)]">
                  <td className="py-1.5 pr-4">{libelle}</td>
                  <td className="py-1.5 pr-4 text-right font-mono tabular-nums">
                    {nombreDeDepots(montants)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {formaterMontants(montants)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
        <Section titre={L.risque}>
          <div className="grid grid-cols-2 gap-3">
            <Compteur libelle="Paiement en échec" valeur={vue.subscriptionsAtRisk.pastDue} />
            <Compteur libelle="Période de grâce" valeur={vue.subscriptionsAtRisk.grace} />
          </div>
        </Section>
      </div>
    </div>
  );
}
