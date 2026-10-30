'use client';

// Rapports du CRM — ADR-0040 § 7.2 et § 8.2 (lot C6).
//
// Six blocs : entonnoir par étape, taux de conversion, durée du cycle de vente,
// résultats par responsable, prévision pondérée par mois de clôture prévue,
// motifs de perte. Tous les chiffres viennent de `GET /crm/reports` (moteur
// `crmReports`) : l'écran ne calcule rien. Montants par devise, jamais
// convertis, toujours « estimés » ; un taux ou une durée sous le seuil dit
// l'échantillon et le minimum, jamais 0 %.
//
// Graphiques : barres HTML/CSS (aucune bibliothèque), décoratives — chaque
// valeur est écrite en texte à côté, et chaque bloc propose son tableau.

import {
  BarChart3,
  CalendarRange,
  CircleX,
  Filter,
  Timer,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { CRM_REPORT_ESTIMATE_LABEL } from '@lalanda/shared/crm';

import { crmReportsApi, type CrmReportsView } from '@/lib/api-crm-reports';

import { Alerte, CHAMP } from '../../../ventes/_components/form-ui';
import { jourKinshasa } from '../../_components/activites-model';
import { useAccesCrm } from '../../_components/crm-access';
import { Bandeau, Panneau, PhraseSection, Tuile } from '../../_components/crm-ui';

import {
  MENTION_TRONQUE,
  PERIODES_MOIS,
  PERIODE_PAR_DEFAUT,
  libelleNombreOpp,
  libellePeriode,
  libelleSourceProbabilite,
  lignesConversion,
  lignesEntonnoir,
  lignesMotifs,
  lignesPrevisionMois,
  lignesResponsables,
  messageRapports,
  periodeDepuis,
  phrasePeriode,
  requeteRapports,
  texteDuree,
  texteTaux,
  type PeriodeMois,
} from './rapports-model';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-[var(--foreground-muted)]';
const TD = 'px-3 py-2 align-top tabular-nums';

export function RapportsEcran(): React.ReactElement {
  const { membres } = useAccesCrm();
  const [periode, setPeriode] = useState<PeriodeMois>(PERIODE_PAR_DEFAUT);
  const [responsable, setResponsable] = useState('');
  const [vue, setVue] = useState<CrmReportsView | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    setChargement(true);
    crmReportsApi
      .get(requeteRapports(periode, responsable, jourKinshasa(new Date())))
      .then((v) => {
        if (annule) return;
        setVue(v);
        setErreur(null);
      })
      .catch((err) => {
        if (!annule) setErreur(messageRapports(err));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, [periode, responsable]);

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-busy={chargement}>
      <Bandeau
        icone={BarChart3}
        titre="Rapports"
        sousTitre={
          vue ? phrasePeriode(vue) : 'Entonnoir, conversion, cycle, responsables, prévision.'
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            Période
            <select
              className={CHAMP}
              value={periode}
              onChange={(e) => setPeriode(periodeDepuis(e.target.value))}
            >
              {PERIODES_MOIS.map((m) => (
                <option key={m} value={m}>
                  {libellePeriode(m)}
                  {m === PERIODE_PAR_DEFAUT ? ' (par défaut)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            Responsable
            <select
              className={CHAMP}
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
            >
              <option value="">Toute l’organisation</option>
              <option value="me">Les miennes</option>
              {membres.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          {vue?.label ?? CRM_REPORT_ESTIMATE_LABEL} Montants par devise, sans conversion.
        </p>
      </Bandeau>

      <p className="sr-only" role="status" aria-live="polite">
        {chargement ? 'Chargement des rapports…' : vue ? 'Rapports à jour.' : ''}
      </p>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {vue?.truncated ? (
        <div
          role="note"
          className="rounded-[var(--radius-md)] border border-[var(--warn)] bg-[color-mix(in_srgb,var(--warn)_10%,transparent)] p-4 text-sm"
        >
          <p className="font-semibold">Chiffres partiels</p>
          <p>{MENTION_TRONQUE}</p>
        </div>
      ) : null}

      {vue === null ? (
        chargement ? (
          <p className="text-sm text-[var(--foreground-muted)]">Chargement des rapports…</p>
        ) : null
      ) : (
        <div className={`flex min-w-0 flex-col gap-5 ${chargement ? 'opacity-60' : ''}`}>
          <Synthese vue={vue} />
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Entonnoir vue={vue} />
            <Conversion vue={vue} />
          </div>
          <PrevisionMois vue={vue} />
          <Responsables vue={vue} />
          <Motifs vue={vue} />
        </div>
      )}
    </section>
  );
}

// ── Briques ─────────────────────────────────────────────────────────────────

/** Barre décorative : la valeur est toujours écrite en texte à côté. */
function Barre({
  largeur,
  ton = 'run',
}: {
  largeur: number;
  ton?: 'run' | 'warn';
}): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className="block h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-inset ring-[var(--border)]"
    >
      <span
        className={`block h-full rounded-full ${ton === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--module-run)]'}`}
        style={{ width: `${largeur}%` }}
      />
    </span>
  );
}

function MentionEstime(): React.ReactElement {
  return (
    <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] font-medium text-[var(--foreground-muted)]">
      Montants estimés
    </span>
  );
}

function Tableau({
  legende,
  children,
}: {
  legende: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <details className="group text-sm">
      <summary className="cursor-pointer select-none text-xs font-medium text-[var(--module-run)]">
        Afficher le tableau
      </summary>
      <div className="mt-2 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
        <table className="w-full min-w-[28rem] border-collapse text-sm">
          <caption className="sr-only">{legende}</caption>
          {children}
        </table>
      </div>
    </details>
  );
}

function Lignes({ textes, vide = '—' }: { textes: string[]; vide?: string }): React.ReactElement {
  if (textes.length === 0) return <span className="text-[var(--foreground-muted)]">{vide}</span>;
  return (
    <span className="flex flex-col">
      {textes.map((t) => (
        <span key={t}>{t}</span>
      ))}
    </span>
  );
}

function Bloc({
  id,
  titre,
  icone,
  children,
}: {
  id: string;
  titre: string;
  icone: LucideIcon;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Panneau id={id} titre={titre} icone={icone} action={<MentionEstime />}>
      {children}
    </Panneau>
  );
}

// ── Blocs ───────────────────────────────────────────────────────────────────

function Synthese({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const global = texteTaux(vue.conversion.overall);
  const gagnees = texteDuree(vue.cycle.won, 'gagnées');
  const perdues = texteDuree(vue.cycle.lost, 'perdues');
  return (
    <section
      aria-labelledby="rapports-synthese"
      className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[color-mix(in_srgb,var(--module-run)_6%,transparent)] p-4 sm:p-5"
    >
      <h3 id="rapports-synthese" className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <Timer aria-hidden="true" className="h-4 w-4 text-[var(--module-run)]" />
        Taux de conversion et durée du cycle
      </h3>
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        <Tuile
          libelle="Opportunités créées"
          valeur={String(vue.funnel.created)}
          detail="Dans la période"
        />
        <Tuile
          libelle="Taux de conversion global (gagnées / clôturées)"
          valeur={global.valeur}
          detail={global.detail}
        />
        <Tuile
          libelle="Durée moyenne du cycle — gagnées"
          valeur={gagnees.valeur}
          detail={gagnees.detail}
        />
        <Tuile
          libelle="Durée moyenne du cycle — perdues"
          valeur={perdues.valeur}
          detail={perdues.detail}
        />
      </div>
    </section>
  );
}

function Entonnoir({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const lignes = lignesEntonnoir(vue);
  return (
    <Bloc id="rapports-entonnoir" titre="Entonnoir par étape" icone={Filter}>
      <PhraseSection>
        {libelleNombreOpp(vue.funnel.created)} créée{vue.funnel.created > 1 ? 's' : ''} dans la
        période ; nombre passé par chaque étape ouverte.
      </PhraseSection>
      {lignes.length === 0 ? (
        <PhraseSection>Aucune étape ouverte dans les réglages.</PhraseSection>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {lignes.map((l) => (
              <li key={l.stageKey} className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-medium">{l.etape}</span>
                  <span className="tabular-nums">{l.texteNombre}</span>
                </span>
                <Barre largeur={l.largeur} />
                {l.montants.length > 0 ? (
                  <span className="text-xs text-[var(--foreground-muted)] tabular-nums">
                    {l.montants.join(' · ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          <Tableau legende="Entonnoir par étape : nombre et montants estimés par devise">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className={TH}>
                  Étape
                </th>
                <th scope="col" className={TH}>
                  Opportunités
                </th>
                <th scope="col" className={TH}>
                  Montants estimés
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.stageKey} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.etape}
                  </th>
                  <td className={TD}>{l.nombre}</td>
                  <td className={TD}>
                    <Lignes textes={l.montants} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </>
      )}
    </Bloc>
  );
}

function Conversion({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const lignes = lignesConversion(vue);
  return (
    <Bloc id="rapports-conversion" titre="Taux de conversion par étape" icone={TrendingUp}>
      <PhraseSection>
        Part des opportunités passées par une étape qui ont atteint une étape ultérieure. Seuil :{' '}
        {vue.minSample} opportunités.
      </PhraseSection>
      {lignes.length === 0 ? (
        <PhraseSection>Aucune étape à comparer.</PhraseSection>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {lignes.map((l) => (
              <li key={`${l.de}-${l.vers}`} className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-medium">
                    {l.de} <span aria-hidden="true">→</span>
                    <span className="sr-only">vers</span> {l.vers}
                  </span>
                  <span className={`tabular-nums ${l.taux.disponible ? 'font-semibold' : ''}`}>
                    {l.taux.valeur}
                  </span>
                </span>
                {l.taux.disponible ? <Barre largeur={l.largeur} /> : null}
                <span className="text-xs text-[var(--foreground-muted)]">{l.taux.detail}</span>
              </li>
            ))}
          </ul>
          <Tableau legende="Taux de conversion par étape">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className={TH}>
                  De
                </th>
                <th scope="col" className={TH}>
                  Vers
                </th>
                <th scope="col" className={TH}>
                  Taux
                </th>
                <th scope="col" className={TH}>
                  Base
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr
                  key={`${l.de}-${l.vers}`}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.de}
                  </th>
                  <td className={TD}>{l.vers}</td>
                  <td className={TD}>{l.taux.valeur}</td>
                  <td className={TD}>{l.taux.detail}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </>
      )}
    </Bloc>
  );
}

function PrevisionMois({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const lignes = lignesPrevisionMois(vue);
  return (
    <Bloc
      id="rapports-prevision"
      titre="Prévision pondérée par mois de clôture prévue"
      icone={CalendarRange}
    >
      <PhraseSection>
        Opportunités ouvertes aujourd’hui.{' '}
        {libelleSourceProbabilite(vue.forecastByMonth.probabilitySource)} Chaque barre est rapportée
        au plus grand montant de sa devise.
      </PhraseSection>
      {lignes.length === 0 ? (
        <PhraseSection>Aucune opportunité ouverte.</PhraseSection>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {lignes.map((l) => (
              <li key={l.cle} className="flex min-w-0 flex-col gap-1.5">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className={`font-medium ${l.enRetard ? 'text-[var(--warn)]' : ''}`}>
                    {l.periode}
                  </span>
                  <span className="tabular-nums text-[var(--foreground-muted)]">{l.nombre}</span>
                </span>
                {l.devises.length === 0 ? (
                  <span className="text-xs text-[var(--foreground-muted)]">Aucun montant.</span>
                ) : (
                  l.devises.map((d) => (
                    <span key={d.currency} className="flex min-w-0 flex-col gap-0.5">
                      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                        <span className="font-semibold tabular-nums">{d.pondere} pondéré</span>
                        <span className="tabular-nums text-[var(--foreground-muted)]">
                          Non pondéré : {d.brut}
                        </span>
                      </span>
                      <Barre largeur={d.largeur} ton={l.enRetard ? 'warn' : 'run'} />
                      {d.nonPonderable ? (
                        <span className="text-xs text-[var(--foreground-muted)]">
                          {d.nonPonderable}
                        </span>
                      ) : null}
                    </span>
                  ))
                )}
              </li>
            ))}
          </ul>
          <Tableau legende="Prévision pondérée par mois de clôture prévue, par devise">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className={TH}>
                  Période
                </th>
                <th scope="col" className={TH}>
                  Opportunités
                </th>
                <th scope="col" className={TH}>
                  Pondéré
                </th>
                <th scope="col" className={TH}>
                  Non pondéré
                </th>
                <th scope="col" className={TH}>
                  Non pondérable
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.periode}
                  </th>
                  <td className={TD}>{l.nombre}</td>
                  <td className={TD}>
                    <Lignes textes={l.devises.map((d) => d.pondere)} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={l.devises.map((d) => d.brut)} />
                  </td>
                  <td className={TD}>
                    <Lignes
                      textes={l.devises.flatMap((d) => (d.nonPonderable ? [d.nonPonderable] : []))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </>
      )}
    </Bloc>
  );
}

function Responsables({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const { membres } = useAccesCrm();
  const lignes = lignesResponsables(vue, membres);
  return (
    <Bloc id="rapports-responsables" titre="Résultats par responsable" icone={Users}>
      <PhraseSection>
        Ouvertes aujourd’hui ; gagnées et perdues dans la période. Taux de gain sous seuil de{' '}
        {vue.minSample} opportunités clôturées.
      </PhraseSection>
      {lignes.length === 0 ? (
        <PhraseSection>Aucune opportunité pour ce filtre.</PhraseSection>
      ) : (
        <>
          <ul className="grid min-w-0 gap-3 lg:grid-cols-2">
            {lignes.map((l) => (
              <li
                key={l.cle}
                className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
              >
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-semibold break-words">{l.nom}</span>
                  <span className="text-sm">
                    Taux de gain :{' '}
                    <span className="font-semibold tabular-nums">{l.tauxGain.valeur}</span>
                  </span>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">{l.tauxGain.detail}</span>
                <dl className="grid grid-cols-1 gap-2 text-sm min-[420px]:grid-cols-3">
                  {(
                    [
                      ['Ouvertes', l.ouvertes],
                      ['Gagnées', l.gagnees],
                      ['Perdues', l.perdues],
                    ] as const
                  ).map(([titre, v]) => (
                    <div
                      key={titre}
                      className="min-w-0 rounded-[var(--radius-sm)] bg-[var(--surface-muted)] px-2.5 py-2"
                    >
                      <dt className="text-xs text-[var(--foreground-muted)]">{titre}</dt>
                      <dd className="font-medium tabular-nums">{v.nombre}</dd>
                      {v.montants.length > 0 ? (
                        <dd className="text-xs tabular-nums break-words">
                          <Lignes textes={v.montants} />
                        </dd>
                      ) : null}
                    </div>
                  ))}
                </dl>
                <p className="text-xs">
                  <span className="text-[var(--foreground-muted)]">Prévision : </span>
                  {l.prevision.length > 0 ? l.prevision.join(' · ') : 'aucune opportunité ouverte'}
                </p>
                {l.motifs.length > 0 ? (
                  <p className="text-xs">
                    <span className="text-[var(--foreground-muted)]">Motifs de perte : </span>
                    {l.motifs.join(' · ')}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          <Tableau legende="Résultats par responsable">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className={TH}>
                  Responsable
                </th>
                <th scope="col" className={TH}>
                  Ouvertes
                </th>
                <th scope="col" className={TH}>
                  Gagnées
                </th>
                <th scope="col" className={TH}>
                  Perdues
                </th>
                <th scope="col" className={TH}>
                  Taux de gain
                </th>
                <th scope="col" className={TH}>
                  Prévision pondérée
                </th>
                <th scope="col" className={TH}>
                  Motifs de perte
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.nom}
                  </th>
                  <td className={TD}>
                    <Lignes textes={[l.ouvertes.nombre, ...l.ouvertes.montants]} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={[l.gagnees.nombre, ...l.gagnees.montants]} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={[l.perdues.nombre, ...l.perdues.montants]} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={[l.tauxGain.valeur, l.tauxGain.detail]} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={l.prevision} />
                  </td>
                  <td className={TD}>
                    <Lignes textes={l.motifs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </>
      )}
    </Bloc>
  );
}

function Motifs({ vue }: { vue: CrmReportsView }): React.ReactElement {
  const lignes = lignesMotifs(vue);
  return (
    <Bloc id="rapports-motifs" titre="Motifs de perte" icone={CircleX}>
      <PhraseSection>
        {libelleNombreOpp(vue.lostReasons.total)} perdue{vue.lostReasons.total > 1 ? 's' : ''} dans
        la période.
      </PhraseSection>
      {lignes.length === 0 ? null : (
        <>
          <ul className="flex flex-col gap-3">
            {lignes.map((l) => (
              <li key={l.cle} className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-medium break-words">{l.motif}</span>
                  <span className="tabular-nums">{l.nombre}</span>
                </span>
                <Barre largeur={l.largeur} />
              </li>
            ))}
          </ul>
          <Tableau legende="Motifs de perte">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th scope="col" className={TH}>
                  Motif
                </th>
                <th scope="col" className={TH}>
                  Opportunités perdues
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle} className="border-b border-[var(--border)] last:border-0">
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.motif}
                  </th>
                  <td className={TD}>{l.nombre}</td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </>
      )}
    </Bloc>
  );
}
