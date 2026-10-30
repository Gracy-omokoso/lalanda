'use client';

// Rapports RH (ADR-0045 § 3.3, § 7), lot H7. Tous les chiffres viennent de
// `GET /hr/reports` (moteur RH) : l'écran ne calcule rien. Barres en HTML/CSS,
// décoratives : chaque valeur est écrite en texte, et chaque bloc propose son
// tableau équivalent. Export du registre non sensible (CSV) avec `hr.read` et
// `hr.manage` ; aucune donnée salariale nulle part.

import { buttonClasses } from '@lalanda/ui';
import {
  BarChart3,
  Download,
  Hourglass,
  LogIn,
  Stethoscope,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import type { HrDepartmentView } from '@/lib/api-hr';
import { hrApi } from '@/lib/api-hr';
import { hrAdminApi, type HrReportsView } from '@/lib/api-hr-admin';

import { Alerte, CHAMP } from '../../ventes/_components/form-ui';

import {
  LIBELLES_PERIODE,
  MENTION_ABSENTEISME,
  MENTION_TAUX_SORTIE,
  PERIODES,
  formatDecimal,
  formatTaux,
  lignesAbsenteisme,
  lignesAnciennete,
  lignesComptes,
  lignesSorties,
  peutExporterRegistre,
  periodeDepuis,
  phrasePeriodeRapport,
  requeteRapports,
  type LigneBarre,
  type Periode,
} from './rapports-model';
import { useAccesRh } from './rh-access';
import { aujourdhui, formatJour, lire, messageRh, peutLireRh, type Lecture } from './rh-model';
import {
  Bandeau,
  Chargement,
  EchecLecture,
  Panneau,
  PhraseSection,
  Tuile,
  enregistrerFichier,
} from './rh-ui';

const TH = 'px-3 py-2 text-left text-xs font-semibold text-[var(--foreground-muted)]';
const TD = 'px-3 py-2 align-top tabular-nums';

export function RapportsRh(): React.ReactElement {
  const { actions } = useAccesRh();
  const autorise = peutLireRh(actions);
  const exporter = peutExporterRegistre(actions);
  const [periode, setPeriode] = useState<Periode>('annee');
  const [service, setService] = useState('');
  const [services, setServices] = useState<HrDepartmentView[]>([]);
  const [lecture, setLecture] = useState<Lecture<HrReportsView> | null>(null);
  const [version, setVersion] = useState(0);
  const [export_, setExport] = useState<{ envoi: boolean; erreur: string | null }>({
    envoi: false,
    erreur: null,
  });

  useEffect(() => {
    if (!autorise) return;
    hrApi
      .listDepartments()
      .then((r) => setServices(r.items.filter((d) => d.active)))
      .catch(() => undefined);
  }, [autorise]);

  useEffect(() => {
    if (!autorise) return;
    let annule = false;
    void lire(hrAdminApi.getReports(requeteRapports(periode, aujourdhui(), service))).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [autorise, periode, service, version]);

  if (!autorise) {
    return (
      <PhraseSection>
        Les rapports RH sont réservés aux personnes qui consultent les dossiers.
      </PhraseSection>
    );
  }

  async function exporterRegistre(): Promise<void> {
    setExport({ envoi: true, erreur: null });
    try {
      const f = await hrAdminApi.exportRegister(service || undefined);
      enregistrerFichier(f.blob, f.nom);
      setExport({ envoi: false, erreur: null });
    } catch (err) {
      setExport({ envoi: false, erreur: messageRh(err, 'L’export du registre a échoué.') });
    }
  }

  const vue = lecture?.ok ? lecture.valeur : null;

  return (
    <section className="flex min-w-0 flex-col gap-5" aria-busy={lecture === null}>
      <Bandeau
        icone={BarChart3}
        titre="Rapports"
        sousTitre={
          vue ? phrasePeriodeRapport(vue) : 'Effectif, entrées et sorties, absentéisme, ancienneté.'
        }
        actions={
          exporter ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'sm')}
              disabled={export_.envoi}
              onClick={() => void exporterRegistre()}
            >
              <Download aria-hidden="true" className="mr-1 h-4 w-4" />
              {export_.envoi ? 'Export…' : 'Exporter le registre (CSV)'}
            </button>
          ) : null
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
              {PERIODES.map((p) => (
                <option key={p} value={p}>
                  {LIBELLES_PERIODE[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium">
            Service
            <select className={CHAMP} value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">Toute l’organisation</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-xs text-[var(--foreground-muted)]">
          Chiffres calculés par Lalanda. Aucune donnée salariale ni sensible ;{' '}
          {exporter
            ? 'le registre exporté ne contient que le dossier non sensible et l’export est journalisé.'
            : 'l’export du registre est réservé aux personnes qui gèrent les dossiers.'}
        </p>
      </Bandeau>

      {export_.erreur ? (
        <Alerte>
          <p>{export_.erreur}</p>
        </Alerte>
      ) : null}

      {lecture === null ? (
        <Chargement texte="Chargement des rapports…" />
      ) : !lecture.ok ? (
        <EchecLecture
          erreur={lecture.erreur}
          repli="Les rapports sont illisibles."
          onReessayer={() => setVersion((v) => v + 1)}
        />
      ) : vue ? (
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tuile
              libelle={`Effectif au ${formatJour(vue.headcount.asOf)}`}
              valeur={vue.headcount.total}
            />
            <Tuile libelle="Entrées" valeur={vue.movements.entries} />
            <Tuile libelle="Sorties" valeur={vue.movements.exits} />
            <Tuile
              libelle="Taux de sortie"
              valeur={formatTaux(vue.movements.exitRatePercent)}
              detail={`Effectif moyen : ${formatDecimal(vue.movements.averageHeadcount)}`}
            />
          </div>
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            <Bloc id="rh-rap-service" titre="Effectif par service" icone={Users}>
              <Barres
                legende="Effectif par service"
                colonne="Personnes"
                lignes={lignesComptes(vue.headcount.byDepartment)}
              />
            </Bloc>
            <Bloc id="rh-rap-contrat" titre="Effectif par type de contrat" icone={Users}>
              <Barres
                legende="Effectif par type de contrat"
                colonne="Personnes"
                lignes={lignesComptes(vue.headcount.byContractType)}
              />
            </Bloc>
            <Bloc id="rh-rap-sorties" titre="Sorties par nature" icone={LogIn}>
              <p className="text-xs text-[var(--foreground-muted)]">{MENTION_TAUX_SORTIE}</p>
              <Barres
                legende="Sorties par nature"
                colonne="Sorties"
                lignes={lignesSorties(vue.movements)}
              />
            </Bloc>
            <Bloc id="rh-rap-anciennete" titre="Ancienneté" icone={Hourglass}>
              <p className="text-xs text-[var(--foreground-muted)]">
                Au {formatJour(vue.seniority.asOf)}, {vue.seniority.total} personnes.
              </p>
              <Barres
                legende="Ancienneté par tranche"
                colonne="Personnes"
                lignes={lignesAnciennete(vue.seniority)}
              />
            </Bloc>
          </div>
          <Bloc id="rh-rap-absenteisme" titre="Absentéisme par service" icone={Stethoscope}>
            <p className="text-xs text-[var(--foreground-muted)]">{MENTION_ABSENTEISME}</p>
            <Barres
              legende="Taux d’absentéisme par service"
              colonne="Taux"
              lignes={lignesAbsenteisme(vue.absenteeism)}
              ton="warn"
            />
            <p className="text-sm">
              Ensemble : {formatTaux(vue.absenteeism.total.ratePercent)} (
              {formatDecimal(vue.absenteeism.total.absenceDays)} jours d’absence sur{' '}
              {formatDecimal(vue.absenteeism.total.theoreticalDays)} jours théoriques).
            </p>
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-medium text-[var(--module-run)]">
                Détail des jours par service
              </summary>
              <div className="mt-2 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
                <table className="w-full min-w-[28rem] border-collapse text-sm">
                  <caption className="sr-only">Absentéisme par service, en jours</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        Service
                      </th>
                      <th scope="col" className={TH}>
                        Personnes
                      </th>
                      <th scope="col" className={TH}>
                        Jours théoriques
                      </th>
                      <th scope="col" className={TH}>
                        Jours d’absence
                      </th>
                      <th scope="col" className={TH}>
                        Taux
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {vue.absenteeism.groups.map((g) => (
                      <tr key={g.departmentId ?? '∅'} className="border-t border-[var(--border)]">
                        <th scope="row" className={`${TD} text-left font-medium`}>
                          {g.label}
                        </th>
                        <td className={TD}>{g.employees}</td>
                        <td className={TD}>{formatDecimal(g.theoreticalDays)}</td>
                        <td className={TD}>{formatDecimal(g.absenceDays)}</td>
                        <td className={TD}>{formatTaux(g.ratePercent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Bloc>
        </div>
      ) : null}
    </section>
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
    <Panneau titre={titre} icone={icone} id={id}>
      {children}
    </Panneau>
  );
}

/** Barres décoratives, valeur écrite en texte ; tableau équivalent en dessous. */
function Barres({
  legende,
  colonne,
  lignes,
  ton = 'run',
}: {
  legende: string;
  colonne: string;
  lignes: LigneBarre[];
  ton?: 'run' | 'warn';
}): React.ReactElement {
  if (lignes.length === 0) return <PhraseSection>Rien à montrer sur cette période.</PhraseSection>;
  return (
    <>
      <ul className="flex flex-col gap-2 text-sm" aria-label={legende}>
        {lignes.map((l) => (
          <li
            key={l.cle}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1"
          >
            <span className="min-w-0 break-words">{l.libelle}</span>
            <span className="font-medium tabular-nums">{l.valeur}</span>
            <span
              aria-hidden="true"
              className="col-span-2 block h-2.5 w-full overflow-hidden rounded-full bg-[var(--surface-muted)] ring-1 ring-inset ring-[var(--border)]"
            >
              <span
                className={`block h-full rounded-full ${ton === 'warn' ? 'bg-[var(--warn)]' : 'bg-[var(--module-run)]'}`}
                style={{ width: `${l.largeur}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
      <details className="text-sm">
        <summary className="cursor-pointer select-none text-xs font-medium text-[var(--module-run)]">
          Afficher le tableau
        </summary>
        <div className="mt-2 max-w-full overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)]">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{legende}</caption>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  Libellé
                </th>
                <th scope="col" className={TH}>
                  {colonne}
                </th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => (
                <tr key={l.cle} className="border-t border-[var(--border)]">
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {l.libelle}
                  </th>
                  <td className={TD}>{l.valeur}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
