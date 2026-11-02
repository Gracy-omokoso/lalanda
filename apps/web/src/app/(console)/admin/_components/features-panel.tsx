'use client';

// Fonctionnalités par offre (ADR-0053 § 6.3 — lot P4) : grille offre × fonctionnalité
// en LECTURE SEULE, dérogations actives, et accord ou levée d'une dérogation.
//
// La grille ne s'édite pas ici (O5-b) : elle vit en code, revue et testée. La console
// montre qui a quoi et accorde des dérogations par organisation, motivées et datées
// (90 jours au plus). Chaque geste exige la ré-authentification de dix minutes, est
// inscrit au journal plateforme et paraît au journal du client sous « Équipe Lalanda »
// avec une raison générique — jamais le nom de l'opérateur ni la note interne.

import { useCallback, useEffect, useState } from 'react';

import {
  PLATFORM_REASON_CATEGORY_LABELS,
  type PlatformReasonCategory,
} from '@lalanda/shared/platform';
import { FEATURE_KEYS } from '@lalanda/shared/pricing';

import { api, type AdminFeatureOverrideView, type AdminFeaturesView } from '@/lib/api';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import { exigeReauth, formaterDate, LIBELLES_PLAN, messageErreur } from './admin-model';
import { ChampsMotif } from './champs-motif';
import {
  derogationComplete,
  derogationVide,
  echeanceIso,
  libelleFonctionnalite,
  resumeGrille,
  type DerogationSaisie,
} from './features-model';
import { noteInterneValide } from './motif-model';
import { ReauthGate, useReauth } from './reauth-gate';

const REAUTH_FONCTIONNALITES =
  'Accorder ou lever une dérogation exige une ré-authentification, valable dix minutes. Chaque geste est motivé, inscrit au journal plateforme et paraît au journal du client sous « Équipe Lalanda ».';

const CHAMP = 'rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';

export function FeaturesPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const peutDeroger = acces.actions.includes('platform.features.override');
  const [vue, setVue] = useState<AdminFeaturesView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      setVue(await api.getAdminFeatures());
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger les fonctionnalités.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (erreur) return <Bandeau ton="echec">{erreur}</Bandeau>;
  if (!vue) return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;

  return (
    <div className="flex flex-col gap-8">
      <Grille vue={vue} />
      <Derogations vue={vue} peutDeroger={peutDeroger} onMaj={charger} />
    </div>
  );
}

function Grille({ vue }: { vue: AdminFeaturesView }): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold tracking-tight">Grille des offres</h2>
      <Bandeau ton={vue.closedCells === 0 ? 'neutre' : 'attention'}>{resumeGrille(vue)}</Bandeau>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left">
              <th className={`px-3 py-2 ${ETIQUETTE}`}>Fonctionnalité</th>
              {vue.plans.map((p) => (
                <th key={p} className={`px-3 py-2 text-center ${ETIQUETTE}`}>
                  {LIBELLES_PLAN[p]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vue.features.map((f) => (
              <tr key={f.key} className="border-b border-[var(--border)] last:border-0">
                <td className="px-3 py-2">
                  <span className="font-medium">{f.label}</span>
                  <span className="ml-2 font-mono text-xs text-[var(--foreground-muted)]">
                    {f.module.toUpperCase()}
                  </span>
                </td>
                {vue.plans.map((p) => (
                  <td key={p} className="px-3 py-2 text-center">
                    {f.plans[p] ? (
                      <span aria-label="Permise">✓</span>
                    ) : (
                      <span aria-label="Non permise" className="text-[var(--foreground-muted)]">
                        —
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Derogations({
  vue,
  peutDeroger,
  onMaj,
}: {
  vue: AdminFeaturesView;
  peutDeroger: boolean;
  onMaj: () => Promise<void>;
}): React.ReactElement {
  const reauth = useReauth();
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold tracking-tight">Dérogations actives</h2>
      {vue.overrides.length === 0 ? (
        <Vide>Aucune dérogation active.</Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {vue.overrides.map((o) => (
            <LigneDerogation
              key={o.id}
              derogation={o}
              peutDeroger={peutDeroger}
              reauth={reauth}
              onMaj={onMaj}
            />
          ))}
        </ul>
      )}
      {peutDeroger ? (
        <ReauthGate reauth={reauth} description={REAUTH_FONCTIONNALITES}>
          <FormulaireDerogation reauth={reauth} onMaj={onMaj} />
        </ReauthGate>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          Votre rôle consulte la grille et les dérogations ; il n’en accorde pas.
        </p>
      )}
    </section>
  );
}

function LigneDerogation({
  derogation,
  peutDeroger,
  reauth,
  onMaj,
}: {
  derogation: AdminFeatureOverrideView;
  peutDeroger: boolean;
  reauth: ReturnType<typeof useReauth>;
  onMaj: () => Promise<void>;
}): React.ReactElement {
  const [note, setNote] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function lever(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      await api.revokeFeatureOverride(derogation.id, { internalNote: note });
      await onMaj();
    } catch (err) {
      if (exigeReauth(err)) reauth.redemander();
      setErreur(messageErreur(err, 'Levée refusée.'));
    } finally {
      setEnvoi(false);
    }
  }

  const categorie =
    PLATFORM_REASON_CATEGORY_LABELS[derogation.reasonCategory as PlatformReasonCategory] ??
    derogation.reasonCategory;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-col">
          <span className="font-medium">
            {libelleFonctionnalite(derogation.feature)} —{' '}
            {derogation.organizationName ?? derogation.targetOrganizationId}
          </span>
          <span className="font-mono text-xs text-[var(--foreground-muted)]">
            {categorie} · jusqu’au {formaterDate(derogation.endsAt)}
          </span>
        </span>
        <Pastille ton="attention">Dérogation</Pastille>
      </div>
      {peutDeroger && reauth.ouverte ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className={ETIQUETTE}>Note interne de levée</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              className={`w-80 ${CHAMP}`}
            />
          </label>
          <button
            type="button"
            disabled={envoi || !noteInterneValide(note)}
            onClick={() => void lever()}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--danger)] disabled:opacity-40"
          >
            {envoi ? 'Levée…' : 'Lever la dérogation'}
          </button>
        </div>
      ) : null}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </li>
  );
}

function FormulaireDerogation({
  reauth,
  onMaj,
}: {
  reauth: ReturnType<typeof useReauth>;
  onMaj: () => Promise<void>;
}): React.ReactElement {
  const [saisie, setSaisie] = useState<DerogationSaisie>(() => derogationVide(new Date()));
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function accorder(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const endsAt = echeanceIso(saisie.echeance);
    if (saisie.feature === '' || saisie.motif.reasonCategory === '' || endsAt === null) return;
    setEnvoi(true);
    setErreur(null);
    setSucces(null);
    try {
      const o = await api.grantFeatureOverride({
        targetOrganizationId: saisie.targetOrganizationId.trim(),
        feature: saisie.feature,
        reasonCategory: saisie.motif.reasonCategory,
        internalNote: saisie.motif.internalNote,
        endsAt,
      });
      setSucces(`Dérogation accordée jusqu’au ${formaterDate(o.endsAt)}.`);
      setSaisie(derogationVide(new Date()));
      await onMaj();
    } catch (err) {
      if (exigeReauth(err)) reauth.redemander();
      setErreur(messageErreur(err, 'Dérogation refusée.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void accorder(e)}
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5"
    >
      <h3 className="font-display text-base font-bold tracking-tight">Accorder une dérogation</h3>
      <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
        Une dérogation ouvre une fonctionnalité que l’offre de l’organisation ne comprend pas,
        jusqu’à son échéance (90 jours au plus). Elle ne ferme jamais rien.
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Identifiant de l’organisation</span>
          <input
            value={saisie.targetOrganizationId}
            onChange={(e) => setSaisie({ ...saisie, targetOrganizationId: e.target.value })}
            placeholder="24 caractères hexadécimaux"
            className={`w-72 font-mono ${CHAMP}`}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Fonctionnalité</span>
          <select
            value={saisie.feature}
            onChange={(e) =>
              setSaisie({ ...saisie, feature: e.target.value as DerogationSaisie['feature'] })
            }
            className={`w-64 ${CHAMP}`}
          >
            <option value="">Choisir…</option>
            {FEATURE_KEYS.map((k) => (
              <option key={k} value={k}>
                {libelleFonctionnalite(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Échéance</span>
          <input
            type="date"
            value={saisie.echeance}
            onChange={(e) => setSaisie({ ...saisie, echeance: e.target.value })}
            className={CHAMP}
          />
        </label>
      </div>
      <ChampsMotif
        motif={saisie.motif}
        onChange={(motif) => setSaisie({ ...saisie, motif })}
        avecCategorie
        avecMessageClient={false}
      />
      <div>
        <button
          type="submit"
          disabled={envoi || !derogationComplete(saisie, new Date())}
          className="rounded-md border border-[var(--accent)] px-3 py-2 text-sm font-medium text-[var(--accent)] transition hover:bg-[var(--accent)]/10 disabled:opacity-40"
        >
          {envoi ? 'Envoi…' : 'Accorder la dérogation'}
        </button>
      </div>
      {succes ? <Bandeau ton="succes">{succes}</Bandeau> : null}
      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}
    </form>
  );
}
