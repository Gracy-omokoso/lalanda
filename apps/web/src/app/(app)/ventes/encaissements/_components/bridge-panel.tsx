'use client';

// Pont vers le réalisé du plan (ADR-0031 § 3). Désactivé par défaut ; l'activer
// demande trois choix explicites (projet, ligne de chiffre d'affaires, mois qui
// ouvre l'exercice 1). « Simuler » montre ce qui serait écrit sans rien écrire.

import { useCallback, useEffect, useState } from 'react';

import {
  api,
  type ActualsBridgeCandidate,
  type ActualsBridgeSettings,
  type ActualsBridgeView,
  type ActualsSyncReport,
} from '@/lib/api';

import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Champ, Pastille } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';
import { messageVentes } from '../../_components/sales-model';

import {
  BRIDGE_STATE_LABELS,
  formatMontantSigne,
  libelleMois,
  libellePeriodeExercice,
  OUTCOME_LABELS,
  SKIP_LABELS,
  syncDemandeAttention,
} from './receipts-model';

export function BridgePanel(): React.ReactElement {
  const { importerRealise } = useAccesVentes();
  const [vue, setVue] = useState<ActualsBridgeView | null>(null);
  const [candidats, setCandidats] = useState<ActualsBridgeCandidate[]>([]);
  const [reglage, setReglage] = useState<ActualsBridgeSettings>({
    enabled: false,
    projectId: null,
    revenueLineId: null,
    exerciseStart: null,
  });
  const [rapport, setRapport] = useState<ActualsSyncReport | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  const charger = useCallback(async () => {
    try {
      const v = await api.getActualsBridge();
      setVue(v);
      setReglage({
        enabled: v.enabled,
        projectId: v.projectId,
        revenueLineId: v.revenueLineId,
        exerciseStart: v.exerciseStart,
      });
      if (importerRealise) setCandidats((await api.getActualsBridgeCandidates()).items);
    } catch (err) {
      setErreur(messageVentes(err, 'Impossible de lire le pont vers le réalisé.'));
    }
  }, [importerRealise]);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(enabled: boolean) {
    setOccupe(true);
    setErreur(null);
    try {
      setVue(await api.putActualsBridge({ ...reglage, enabled }));
      setReglage((r) => ({ ...r, enabled }));
    } catch (err) {
      setErreur(messageVentes(err, 'Réglage refusé.'));
    } finally {
      setOccupe(false);
    }
  }

  async function synchroniser(dryRun: boolean) {
    setOccupe(true);
    setErreur(null);
    try {
      setRapport(await api.syncActualsBridge(dryRun));
      if (!dryRun) setVue(await api.getActualsBridge());
    } catch (err) {
      setErreur(messageVentes(err, 'Synchronisation refusée.'));
    } finally {
      setOccupe(false);
    }
  }

  const projet = candidats.find((c) => c.projectId === reglage.projectId) ?? null;

  return (
    <section aria-labelledby="pont-titre" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="pont-titre" className="font-display text-lg font-bold tracking-tight">
          Relier les ventes au réalisé du plan
        </h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Facultatif. Le chiffre d’affaires hors taxes de vos factures (moins les avoirs) devient le
          réalisé de l’initiative choisie, mois par mois, étiqueté « issu des ventes ». Le plan validé
          n’est jamais modifié ; une période clôturée et une saisie manuelle non plus.
        </p>
      </div>
      {vue ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Pastille ton={vue.state === 'not_configured' ? 'attention' : 'neutre'}>
            {BRIDGE_STATE_LABELS[vue.state]}
          </Pastille>
          {vue.projectName ? <span>Initiative : {vue.projectName}</span> : null}
          {vue.lastSync ? (
            <span className="text-xs text-[var(--foreground-muted)]">
              Dernière synchronisation : {vue.lastSync.written} reporté(s), {vue.lastSync.unchanged}{' '}
              à jour, {vue.lastSync.blocked} bloqué(s)
            </span>
          ) : null}
        </p>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {importerRealise ? (
        <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Champ id="pont-projet" label="Initiative qui reçoit le réalisé">
              <select
                id="pont-projet"
                value={reglage.projectId ?? ''}
                onChange={(e) =>
                  setReglage((r) => ({
                    ...r,
                    projectId: e.target.value === '' ? null : e.target.value,
                    revenueLineId: null,
                  }))
                }
                className={CHAMP}
              >
                <option value="">Choisir…</option>
                {candidats.map((c) => (
                  <option
                    key={c.projectId}
                    value={c.projectId}
                    disabled={c.approvedPlanVersion === null}
                  >
                    {c.name} ({c.currency})
                    {c.approvedPlanVersion === null ? ' — aucun plan validé' : ''}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ id="pont-ligne" label="Ligne de chiffre d’affaires">
              <select
                id="pont-ligne"
                value={reglage.revenueLineId ?? ''}
                onChange={(e) =>
                  setReglage((r) => ({
                    ...r,
                    revenueLineId: e.target.value === '' ? null : e.target.value,
                  }))
                }
                className={CHAMP}
                disabled={!projet}
              >
                <option value="">Choisir…</option>
                {(projet?.lines ?? []).map((l) => (
                  <option key={l.lineId} value={l.lineId}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ
              id="pont-debut"
              label="Mois qui ouvre l’exercice 1"
              aide="Le mois civil où commence le premier exercice du plan. Initiative et début d’exercice sont communs au report des dépenses (Trésorerie)."
            >
              <input
                id="pont-debut"
                type="month"
                value={reglage.exerciseStart ?? ''}
                onChange={(e) =>
                  setReglage((r) => ({
                    ...r,
                    exerciseStart: e.target.value === '' ? null : e.target.value,
                  }))
                }
                className={CHAMP}
                aria-describedby="pont-debut-aide"
              />
            </Champ>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BOUTON}
              disabled={occupe}
              onClick={() => void enregistrer(true)}
            >
              {vue?.enabled ? 'Enregistrer le réglage' : 'Activer le pont'}
            </button>
            {vue?.enabled ? (
              <button
                type="button"
                className={BOUTON}
                disabled={occupe}
                onClick={() => void enregistrer(false)}
              >
                Désactiver
              </button>
            ) : null}
            {vue?.state === 'active' ? (
              <>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={occupe}
                  onClick={() => void synchroniser(true)}
                >
                  Simuler
                </button>
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={occupe}
                  onClick={() => void synchroniser(false)}
                >
                  Synchroniser
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          Régler et lancer le pont demande le droit d’importer le réalisé.
        </p>
      )}

      {rapport ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm font-medium">
            {rapport.dryRun ? 'Simulation (rien n’a été écrit)' : 'Synchronisation effectuée'} —{' '}
            {rapport.counts.written} reporté(s), {rapport.counts.unchanged} à jour,{' '}
            {rapport.counts.removed} retiré(s), {rapport.counts.blocked} bloqué(s),{' '}
            {rapport.counts.skipped} non reporté(s)
          </p>
          {syncDemandeAttention(rapport) ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Certains mois demandent votre attention : voir le détail ci-dessous.
            </p>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {rapport.entries.map((e) => (
              <li key={`${e.year}-${e.month}`}>
                {e.calendarMonth ? `${libelleMois(e.calendarMonth)} · ` : ''}
                {libellePeriodeExercice(e.year, e.month)} :{' '}
                {formatMontantSigne(e.value, rapport.projectCurrency)} — {OUTCOME_LABELS[e.outcome]}
              </li>
            ))}
            {rapport.skipped.map((s) => (
              <li key={`saut-${s.calendarMonth}`} className="text-[var(--foreground-muted)]">
                {libelleMois(s.calendarMonth)} — {SKIP_LABELS[s.reason]}
              </li>
            ))}
            {rapport.excludedDepositIds.length > 0 ? (
              <li className="text-[var(--foreground-muted)]">
                {rapport.excludedDepositIds.length} facture(s) d’acompte non reportée(s) (décision
                en attente de votre expert-comptable).
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
