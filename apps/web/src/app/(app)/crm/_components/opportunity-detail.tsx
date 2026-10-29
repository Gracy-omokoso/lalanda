'use client';

// Fiche d'une opportunité — ADR-0035 § 5 : étape (déplacement, perte avec
// motif), historique, activités (ajout, fin), devis liés et « Créer un devis ».

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type ActivityView, type OpportunityView } from '@/lib/api-crm';

import { Alerte, BOUTON, BOUTON_PETIT, CHAMP, Champ } from '../../ventes/_components/form-ui';
import { formatMontant } from '../../ventes/_components/sales-model';
import { useAccesCrm } from './crm-access';
import { DEVIS_BASE, QUOTE_STATUS_LABELS } from '../../ventes/devis/_components/quote-model';

import {
  ACTIVITY_KINDS,
  ACTIVITY_LABELS,
  CRM_BASE,
  formatEcheance,
  interlocuteur,
  messageCrm,
  montantEstime,
  peutGererCrm,
  preparerActivite,
  type FormulaireActivite,
} from './crm-model';

export function OpportunityDetail({
  opportunityId,
}: {
  opportunityId: string;
}): React.ReactElement {
  const router = useRouter();
  const { actions, gererVentes } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [vue, setVue] = useState<OpportunityView | null>(null);
  const [activites, setActivites] = useState<ActivityView[]>([]);
  const [stages, setStages] = useState<{ key: string; label: string; kind: string }[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [f, setF] = useState<FormulaireActivite>({
    kind: 'call',
    subject: '',
    notes: '',
    echeance: '',
  });
  const [champs, setChamps] = useState<Record<string, string>>({});

  const charger = useCallback(() => {
    Promise.all([
      crmApi.getOpportunity(opportunityId),
      crmApi.listActivities({ opportunityId, limit: 100 }),
      crmApi.getSettings(),
    ])
      .then(([o, a, s]) => {
        setVue(o);
        setActivites(a.items);
        setStages(s.stages);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Opportunité illisible.')));
  }, [opportunityId]);

  useEffect(() => charger(), [charger]);

  async function agir(fn: () => Promise<unknown>): Promise<void> {
    setErreur(null);
    try {
      await fn();
      charger();
    } catch (err) {
      setErreur(messageCrm(err, 'Action impossible.'));
    }
  }

  if (vue === null) {
    return erreur ? (
      <Alerte>
        <p>{erreur}</p>
      </Alerte>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
    );
  }

  const nouveauDevis = `${DEVIS_BASE}/nouveau?${new URLSearchParams({
    opportunite: vue.id,
    ...(vue.customerId ? { client: vue.customerId, nom: vue.customerName ?? '' } : {}),
  }).toString()}`;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <Link href={CRM_BASE} className="text-sm underline underline-offset-2">
          ← Pipeline
        </Link>
        <h2 className="text-xl font-semibold">{vue.title}</h2>
        <p className="text-sm">
          {interlocuteur(vue)}
          {vue.contactName ? ` · contact : ${vue.contactName}` : ''} · {montantEstime(vue)}
          {vue.expectedCloseDate ? ` · clôture prévue le ${vue.expectedCloseDate}` : ''}
        </p>
        <p className="text-sm">
          Étape : <strong>{vue.stageLabel}</strong>
          {vue.lostReason ? ` — motif : ${vue.lostReason}` : ''}
          {vue.stale ? ` · sans activité depuis ${vue.daysSinceActivity} jours` : ''}
        </p>
      </header>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {gerer ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Déplacer vers
            <select
              className={CHAMP}
              value={vue.stageKey}
              onChange={(e) => {
                const cible = stages.find((s) => s.key === e.target.value);
                const motif =
                  cible?.kind === 'lost' ? window.prompt('Motif de la perte (facultatif)') : null;
                void agir(() =>
                  crmApi.moveOpportunity(vue.id, {
                    expectedRevision: vue.revision,
                    stageKey: e.target.value,
                    lostReason: motif?.trim() || null,
                  }),
                );
              }}
            >
              {stages.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={BOUTON_PETIT}
            onClick={() =>
              void agir(async () => {
                if (!window.confirm('Supprimer cette opportunité et ses activités ?')) return;
                await crmApi.deleteOpportunity(vue.id);
                router.push(CRM_BASE);
              })
            }
          >
            Supprimer
          </button>
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Devis</h3>
          {gererVentes ? (
            <Link href={nouveauDevis} className={BOUTON_PETIT}>
              Créer un devis
            </Link>
          ) : null}
        </div>
        <ul className="flex flex-col gap-1 text-sm">
          {vue.quotes.map((q) => (
            <li key={q.id}>
              <Link
                href={`${DEVIS_BASE}/${encodeURIComponent(q.id)}`}
                className="font-mono underline"
              >
                {q.number}
              </Link>{' '}
              v{q.version} — {QUOTE_STATUS_LABELS[q.status]}
              {q.total ? ` — ${formatMontant(q.total, q.currency)}` : ''}
            </li>
          ))}
          {vue.quotes.length === 0 ? <li>Aucun devis.</li> : null}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Activités</h3>
        <ul className="flex flex-col gap-2 text-sm">
          {activites.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-2">
              <span className={a.overdue ? 'font-medium text-[var(--danger)]' : ''}>
                {a.kindLabel} — {a.subject} · {a.done ? 'faite' : formatEcheance(a.dueAt)}
                {a.overdue ? ' (en retard)' : ''}
              </span>
              {gerer && !a.done ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  onClick={() => void agir(() => crmApi.completeActivity(a.id, a.revision))}
                >
                  Marquer faite
                </button>
              ) : null}
            </li>
          ))}
          {activites.length === 0 ? <li>Aucune activité.</li> : null}
        </ul>
        {gerer ? (
          <form
            className="grid gap-2 rounded-md border border-dashed border-[var(--border)] p-3 sm:grid-cols-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              const p = preparerActivite(f, vue.id);
              if (!p.ok) {
                setChamps(p.champs);
                return;
              }
              setChamps({});
              void agir(async () => {
                await crmApi.createActivity(p.corps);
                setF({ kind: f.kind, subject: '', notes: '', echeance: '' });
              });
            }}
          >
            <Champ id="act-kind" label="Nature">
              <select
                id="act-kind"
                className={CHAMP}
                value={f.kind}
                onChange={(e) => setF({ ...f, kind: e.target.value as FormulaireActivite['kind'] })}
              >
                {ACTIVITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ACTIVITY_LABELS[k]}
                  </option>
                ))}
              </select>
            </Champ>
            <Champ id="act-objet" label="Objet" requis erreur={champs['subject']}>
              <input
                id="act-objet"
                className={CHAMP}
                value={f.subject}
                maxLength={200}
                onChange={(e) => setF({ ...f, subject: e.target.value })}
              />
            </Champ>
            {f.kind !== 'note' ? (
              <Champ id="act-echeance" label="Échéance" erreur={champs['dueAt']}>
                <input
                  id="act-echeance"
                  type="date"
                  className={CHAMP}
                  value={f.echeance}
                  onChange={(e) => setF({ ...f, echeance: e.target.value })}
                />
              </Champ>
            ) : null}
            <button type="submit" className={`${BOUTON} self-end`}>
              Ajouter
            </button>
          </form>
        ) : null}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Historique des étapes</h3>
        <ol className="text-sm">
          {vue.stageHistory.map((e, i) => (
            <li key={`${e.stageKey}-${i}`}>
              {new Date(e.at).toLocaleDateString('fr-FR')} — {e.stageLabel}
              {e.source === 'quote' ? ' (devis accepté)' : e.source === 'import' ? ' (import)' : ''}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
