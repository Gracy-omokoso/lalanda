'use client';

// Brief du matin (ADR-0033) — chiffres du moteur, alertes et recommandations de
// règles sourcées, puis, à la demande, l'explication rédigée par l'IA.
//
// L'IA n'est jamais appelée au chargement : seulement sur un clic, parce qu'un
// appel consomme le quota du mois. Chaque texte dit d'où il vient (« Rédigé par
// l'IA — chiffres vérifiés » ou « Lecture automatique ») et cite ses sources.
// Aucune action n'est exécutée depuis cet écran : chaque recommandation mène à
// la page où l'utilisateur agit lui-même.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import {
  morningBriefApi,
  type BriefAnswerView,
  type BriefIntent,
  type BriefRuleOutcomeView,
  type MorningBriefPreferences,
  type MorningBriefView,
} from '@/lib/morning-brief-api';

import {
  ANOMALIES,
  TUILES,
  fait,
  faitsParDevise,
  libelleGravite,
  libelleSeuil,
  lignesTuile,
  provenance,
  resumeQuota,
  sourcesRegle,
  valeurFait,
} from './morning-brief-model';
import { estRefus, messageErreur } from './organization-model';

export function MorningBriefPanel(): React.ReactElement {
  const [vue, setVue] = useState<MorningBriefView | null>(null);
  const [prefs, setPrefs] = useState<MorningBriefPreferences | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const charger = useCallback(async (): Promise<void> => {
    setChargement(true);
    setErreur(null);
    try {
      const [v, p] = await Promise.all([morningBriefApi.get(), morningBriefApi.preferences()]);
      setVue(v);
      setPrefs(p);
    } catch (err) {
      setErreur(
        estRefus(err)
          ? 'Aucune organisation active, ou votre rôle ne donne pas accès au brief.'
          : messageErreur(err, 'Impossible de charger le brief du matin.'),
      );
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  if (chargement) return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  if (erreur || !vue) {
    return (
      <div
        role="alert"
        className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
      >
        {erreur ?? 'Brief du matin indisponible.'}
      </div>
    );
  }

  const { brief } = vue;
  const date = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(Date.UTC(brief.period.year, brief.period.month - 1, brief.period.day)),
  );

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h2 className="font-display text-xl font-semibold tracking-tight">Brief du matin</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Situation au {date}. Chiffres calculés par Lalanda à partir de vos factures ; alertes et
          recommandations produites par des règles dont chaque seuil est cité.
        </p>
        {brief.truncated ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Lecture bornée : trop de documents pour un brief, les plus anciens ne sont pas comptés.
          </p>
        ) : null}
      </header>

      {/* ── Chiffres ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="brief-chiffres" className="flex flex-col gap-3">
        <h3 id="brief-chiffres" className="text-sm font-semibold uppercase tracking-wide">
          Chiffres du jour
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {TUILES.map((t) => {
            const faits = faitsParDevise(brief, t.prefixe);
            const source = faits[0]?.source;
            return (
              <div
                key={t.prefixe}
                className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-4"
              >
                <span className="text-xs text-[var(--foreground-muted)]">{t.titre}</span>
                {lignesTuile(faits).map((l) => (
                  <span key={l} className="fig text-lg font-semibold">
                    {l}
                  </span>
                ))}
                <span className="text-xs text-[var(--foreground-muted)]">{t.aide}</span>
                {source ? (
                  <span className="text-[11px] text-[var(--foreground-muted)]">
                    Source : {source.reference}
                  </span>
                ) : null}
              </div>
            );
          })}
          <div className="flex flex-col gap-1 rounded-lg border border-[var(--border)] p-4">
            <span className="text-xs text-[var(--foreground-muted)]">
              Factures normalisées en anomalie
            </span>
            {ANOMALIES.map((id) => {
              const f = fait(brief, id);
              return f ? (
                <span key={id} className="text-sm">
                  <span className="fig font-semibold">{valeurFait(f)}</span>{' '}
                  <span className="text-[var(--foreground-muted)]">{f.label.toLowerCase()}</span>
                </span>
              ) : null;
            })}
            <span className="text-[11px] text-[var(--foreground-muted)]">Source : ADR-0024</span>
          </div>
        </div>
      </section>

      {/* ── Alertes et recommandations ──────────────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ListeRegles
          titre="Trois alertes prioritaires"
          vide="Aucune alerte déclenchée par les règles du brief."
          total={brief.alertCount}
          regles={brief.alerts}
          rendu={(r) => r.message}
          vue={vue}
        />
        <ListeRegles
          titre="Trois recommandations"
          vide="Aucune recommandation aujourd’hui."
          total={brief.triggeredCount}
          regles={brief.recommendations}
          rendu={(r) => r.recommendation}
          vue={vue}
        />
      </div>

      {brief.rulesSkipped.length > 0 ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          {brief.rulesSkipped.length} règle{brief.rulesSkipped.length > 1 ? 's' : ''} non évaluée
          {brief.rulesSkipped.length > 1 ? 's' : ''} (données masquées pour votre rôle ou
          indisponibles) : l’absence d’alerte n’y vaut pas bonne nouvelle.
        </p>
      ) : null}

      <ExplicationIa vue={vue} />

      {prefs ? <Reglages vue={vue} prefs={prefs} onChange={setPrefs} /> : null}
    </div>
  );
}

function ListeRegles(props: {
  titre: string;
  vide: string;
  total: number;
  regles: BriefRuleOutcomeView[];
  rendu: (r: BriefRuleOutcomeView) => string;
  vue: MorningBriefView;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide">{props.titre}</h3>
      {props.regles.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">{props.vide}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {props.regles.map((r) => (
            <li key={r.ruleId} className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--border-strong)] px-2 py-0.5 text-xs">
                  {libelleGravite(r.severity)}
                </span>
                <span className="font-medium">{r.title}</span>
              </div>
              <p className="mt-1">{props.rendu(r)}</p>
              <p className="mt-1 text-xs text-[var(--foreground-muted)]">
                Données : {sourcesRegle(props.vue.brief, r).join(' · ')}
                {libelleSeuil(r.threshold) ? ` — ${libelleSeuil(r.threshold)}` : ''}
              </p>
              <Link
                href={r.actionPath}
                className="mt-1 inline-block text-xs underline hover:text-[var(--accent)]"
              >
                Ouvrir
              </Link>
            </li>
          ))}
        </ol>
      )}
      {props.total > props.regles.length ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          {props.total - props.regles.length} autre
          {props.total - props.regles.length > 1 ? 's' : ''} non affichée
          {props.total - props.regles.length > 1 ? 's' : ''}.
        </p>
      ) : null}
    </section>
  );
}

function ExplicationIa({ vue }: { vue: MorningBriefView }): React.ReactElement {
  const [reponse, setReponse] = useState<BriefAnswerView | null>(null);
  const [enCours, setEnCours] = useState<BriefIntent | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function demander(intent: BriefIntent): Promise<void> {
    setEnCours(intent);
    setErreur(null);
    try {
      setReponse(await morningBriefApi.explain(intent));
    } catch (err) {
      setErreur(messageErreur(err, 'Explication indisponible pour le moment.'));
    } finally {
      setEnCours(null);
    }
  }

  const quota = resumeQuota(vue.ai.quota);
  return (
    <section aria-labelledby="brief-ia" className="flex flex-col gap-3">
      <h3 id="brief-ia" className="text-sm font-semibold uppercase tracking-wide">
        Explication
      </h3>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={enCours !== null}
          onClick={() => void demander('this_week')}
          className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-foreground)] disabled:opacity-60"
        >
          {enCours === 'this_week' ? 'Réflexion…' : 'Que dois-je faire cette semaine ?'}
        </button>
        <button
          type="button"
          disabled={enCours !== null}
          onClick={() => void demander('explain')}
          className="rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {enCours === 'explain' ? 'Rédaction…' : 'Expliquer la situation'}
        </button>
      </div>
      <p className="text-xs text-[var(--foreground-muted)]">
        {vue.ai.enabled
          ? 'L’IA reçoit seulement les chiffres ci-dessus, jamais vos clients ni vos documents ; tout nombre qu’elle écrit est vérifié.'
          : 'IA désactivée : la réponse est rédigée automatiquement à partir des règles.'}
        {quota ? ` ${quota}` : ''}
      </p>
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
      {reponse ? (
        <div className="flex flex-col gap-2 rounded-lg border border-[var(--border)] p-4 text-sm">
          <span className="text-xs font-medium text-[var(--foreground-muted)]">
            {provenance(reponse)}
          </span>
          {reponse.items.map((item, i) => (
            <div key={i} className="flex flex-col gap-1">
              <p>{item.texte}</p>
              {item.sources.length > 0 ? (
                <p className="text-xs text-[var(--foreground-muted)]">
                  Sources : {item.sources.map((s) => s.label).join(' · ')}
                </p>
              ) : null}
            </div>
          ))}
          <p className="text-[11px] text-[var(--foreground-muted)]">{reponse.mention}</p>
        </div>
      ) : null}
    </section>
  );
}

function Reglages(props: {
  vue: MorningBriefView;
  prefs: MorningBriefPreferences;
  onChange: (p: MorningBriefPreferences) => void;
}): React.ReactElement {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function appliquer(fn: () => Promise<MorningBriefPreferences>): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      props.onChange(await fn());
    } catch (err) {
      setErreur(messageErreur(err, 'Réglage non enregistré.'));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <section aria-labelledby="brief-reglages" className="flex flex-col gap-3">
      <h3 id="brief-reglages" className="text-sm font-semibold uppercase tracking-wide">
        Réglages
      </h3>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.prefs.emailDaily}
          disabled={enCours}
          onChange={(e) => void appliquer(() => morningBriefApi.setEmailDaily(e.target.checked))}
          className="mt-1"
        />
        <span>
          Recevoir ce brief par e-mail chaque matin vers 7 h (heure de Kinshasa). L’e-mail reprend
          les chiffres, alertes et recommandations — jamais de texte rédigé par l’IA.
        </span>
      </label>
      {props.vue.canManageAi ? (
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={props.prefs.aiEnabled}
            disabled={enCours || props.prefs.aiDisabledBy === 'platform'}
            onChange={(e) => void appliquer(() => morningBriefApi.setAiEnabled(e.target.checked))}
            className="mt-1"
          />
          <span>
            Permettre l’explication par l’IA pour toute l’organisation.
            {props.prefs.aiDisabledBy === 'platform'
              ? ' Actuellement désactivée par Lalanda pour toutes les organisations.'
              : ''}
          </span>
        </label>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
