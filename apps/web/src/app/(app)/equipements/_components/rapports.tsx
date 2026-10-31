'use client';

// Rapports des équipements — ADR-0046 § 5.2 : registre par statut, catégorie et
// affectation ; coûts d'acquisition et estimation de gestion PAR DEVISE, seulement
// si les valeurs sont visibles. Tous les nombres viennent du moteur.

import { BarChart3 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { assetsApi, type AssetReportsView } from '@/lib/api-assets';

import { useShell } from '../../_components/shell-context';

import { affectesLignes, lignesDevises } from './echeances-model';
import {
  LIBELLES_STATUT,
  formatJour,
  lire,
  valeursAffichees,
  type Lecture,
} from './equipements-model';
import { Bandeau, Chargement, EchecLecture, Panneau, PhraseSection, Tuile } from './equipements-ui';
import { ETIQUETTE_ESTIMATION } from './fiche-model';

export function Rapports(): React.ReactElement {
  const { actions } = useShell();
  const [lecture, setLecture] = useState<Lecture<AssetReportsView> | null>(null);

  useEffect(() => {
    let annule = false;
    void lire(assetsApi.reports()).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, []);

  if (lecture === null) return <Chargement texte="Chargement des rapports…" />;
  if (!lecture.ok)
    return <EchecLecture erreur={lecture.erreur} repli="Les rapports sont illisibles." />;
  const r = lecture.valeur;
  const valeurs = valeursAffichees(actions, r.valuesHidden);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={BarChart3}
        titre="Rapports"
        sousTitre="Le parc en chiffres, calculés par Lalanda."
      >
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tuile libelle="Équipements" valeur={r.total} />
          {r.byStatus.map((s) => (
            <Tuile key={s.status} libelle={LIBELLES_STATUT[s.status]} valeur={s.count} />
          ))}
        </div>
      </Bandeau>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panneau titre="Par catégorie" id="eq-rap-categories">
          {r.byCategory.length === 0 ? (
            <PhraseSection>Aucun équipement.</PhraseSection>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
              {r.byCategory.map((c) => (
                <li key={c.categoryId ?? 'sans'} className="flex flex-col gap-0.5 py-2">
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{c.categoryName ?? 'Sans catégorie'}</span>
                    <span className="tabular-nums">{c.count}</span>
                  </span>
                  {valeurs && c.acquisitionCosts ? (
                    <span className="text-xs text-[var(--foreground-muted)]">
                      {lignesDevises(c.acquisitionCosts).join(' · ')}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panneau>

        <Panneau titre="Affectation" id="eq-rap-affectation">
          <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
            {affectesLignes(r).map(([k, n]) => (
              <li key={k} className="flex justify-between gap-2 py-2">
                <span>{k}</span>
                <span className="tabular-nums">{n}</span>
              </li>
            ))}
          </ul>
        </Panneau>

        {valeurs ? (
          <>
            <Panneau titre="Coûts d’acquisition" id="eq-rap-couts">
              <p className="text-xs text-[var(--foreground-muted)]">
                Équipements actifs, par devise.
              </p>
              {lignesDevises(r.activeAcquisitionCosts).length === 0 ? (
                <PhraseSection>Aucun coût enregistré.</PhraseSection>
              ) : (
                <ul className="flex flex-col gap-1 text-sm tabular-nums">
                  {lignesDevises(r.activeAcquisitionCosts).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </Panneau>
            <Panneau titre="Amortissement indicatif du parc" id="eq-rap-estimation">
              <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--border-strong)] px-2 py-1 text-xs font-medium">
                {ETIQUETTE_ESTIMATION}
              </p>
              {r.managementEstimate === null ? (
                <PhraseSection>L’estimation n’est pas affichée.</PhraseSection>
              ) : (
                <>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Au {formatJour(r.managementEstimate.onDate)}
                  </p>
                  <ul className="flex flex-col gap-1 text-sm tabular-nums">
                    {lignesDevises(r.managementEstimate.estimatedValues).map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  {r.managementEstimate.notEstimable > 0 ? (
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {r.managementEstimate.notEstimable} équipement(s) non estimable(s) : aucune
                      durée saisie ou paramètres incohérents.
                    </p>
                  ) : null}
                </>
              )}
            </Panneau>
          </>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)] lg:col-span-2">
            Les coûts et l’estimation de gestion ne s’affichent qu’aux rôles qui voient les prix
            d’achat ou la trésorerie.
          </p>
        )}
      </div>
    </section>
  );
}
