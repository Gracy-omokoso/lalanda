'use client';

// Pipeline du CRM — ADR-0035 § 5 : vue Kanban (colonnes = étapes, déplacement
// par boutons accessibles au clavier) ou vue liste ; encadrés « relances en
// retard », « prochaines actions » et « inactives ». Totaux par devise et
// probabilité par étape : recopiés de l'API (moteur).

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';
import { crmApi, type OpportunitySummary, type PipelineView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../_components/form-ui';
import { useAccesVentes } from '../../_components/sales-access';

import {
  ACTIVITY_LABELS,
  CRM_BASE,
  etapesVoisines,
  formatEcheance,
  formulaireOpportunite,
  interlocuteur,
  libelleProbabilite,
  messageCrm,
  montantEstime,
  peutGererCrm,
  preparerOpportunite,
  totauxColonne,
  type FormulaireOpportunite,
} from './crm-model';
import { CrmNav, CsvActions } from './crm-nav';

function Carte({
  o,
  board,
  gerer,
  onMove,
}: {
  o: OpportunitySummary;
  board: PipelineView;
  gerer: boolean;
  onMove: (o: OpportunitySummary, stageKey: string) => void;
}): React.ReactElement {
  const { precedente, suivante } = etapesVoisines(board.settings.stages, o.stageKey);
  return (
    <li className="flex flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--background)] p-3 text-sm">
      <Link
        href={`${CRM_BASE}/${encodeURIComponent(o.id)}`}
        className="font-medium underline-offset-2 hover:underline"
      >
        {o.title}
      </Link>
      <span className="text-xs text-[var(--foreground-muted)]">{interlocuteur(o)}</span>
      <span className="font-mono text-xs">{montantEstime(o)}</span>
      {o.stale ? (
        <span className="text-xs font-medium text-[var(--warn,#b45309)]">
          Sans activité depuis {o.daysSinceActivity} jours
        </span>
      ) : null}
      {gerer && o.status === 'open' ? (
        <span className="mt-1 flex gap-1">
          {precedente ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-label={`Ramener « ${o.title} » à l’étape ${precedente.label}`}
              onClick={() => onMove(o, precedente.key)}
            >
              ← {precedente.label}
            </button>
          ) : null}
          {suivante ? (
            <button
              type="button"
              className={BOUTON_PETIT}
              aria-label={`Passer « ${o.title} » à l’étape ${suivante.label}`}
              onClick={() => onMove(o, suivante.key)}
            >
              {suivante.label} →
            </button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

function NouvelleOpportunite({ onCree }: { onCree: () => void }): React.ReactElement {
  const [f, setF] = useState<FormulaireOpportunite>(formulaireOpportunite());
  const [clients, setClients] = useState<CustomerView[]>([]);
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    api
      .listCustomers({ status: 'active', limit: 100 })
      .then((p) => setClients(p.items))
      .catch(() => undefined);
  }, []);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const p = preparerOpportunite(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    try {
      await crmApi.createOpportunity(p.corps);
      setF(formulaireOpportunite());
      setChamps({});
      onCree();
    } catch (err) {
      setErreur(messageCrm(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void creer(e)}
      className="grid gap-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-3"
      noValidate
    >
      <h3 className="text-sm font-semibold sm:col-span-3">Nouvelle opportunité</h3>
      <Champ id="op-titre" label="Titre" requis erreur={champs['title']}>
        <input
          id="op-titre"
          value={f.title}
          onChange={(e) => setF({ ...f, title: e.target.value })}
          className={CHAMP}
          maxLength={200}
          {...aria('op-titre', champs['title'])}
        />
      </Champ>
      <Champ id="op-cible" label="Pour">
        <select
          id="op-cible"
          value={f.cible}
          onChange={(e) => setF({ ...f, cible: e.target.value as 'client' | 'prospect' })}
          className={CHAMP}
        >
          <option value="client">Un client existant</option>
          <option value="prospect">Un prospect</option>
        </select>
      </Champ>
      {f.cible === 'client' ? (
        <Champ id="op-client" label="Client" requis erreur={champs['customerId']}>
          <select
            id="op-client"
            value={f.customerId}
            onChange={(e) => setF({ ...f, customerId: e.target.value })}
            className={CHAMP}
            {...aria('op-client', champs['customerId'])}
          >
            <option value="">Choisir…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Champ>
      ) : (
        <Champ id="op-prospect" label="Prospect" requis erreur={champs['prospectName']}>
          <input
            id="op-prospect"
            value={f.prospectName}
            onChange={(e) => setF({ ...f, prospectName: e.target.value })}
            className={CHAMP}
            maxLength={200}
            {...aria('op-prospect', champs['prospectName'])}
          />
        </Champ>
      )}
      <Champ id="op-montant" label="Montant estimé" erreur={champs['amount']}>
        <input
          id="op-montant"
          inputMode="decimal"
          value={f.montant}
          onChange={(e) => setF({ ...f, montant: e.target.value })}
          placeholder="1 500,00"
          className={CHAMP}
          {...aria('op-montant', champs['amount'])}
        />
      </Champ>
      <Champ id="op-devise" label="Devise">
        <select
          id="op-devise"
          value={f.currency}
          onChange={(e) => setF({ ...f, currency: e.target.value as 'CDF' | 'USD' })}
          className={CHAMP}
        >
          <option value="CDF">CDF</option>
          <option value="USD">USD</option>
        </select>
      </Champ>
      <Champ id="op-cloture" label="Clôture prévue">
        <input
          id="op-cloture"
          type="date"
          value={f.expectedCloseDate}
          onChange={(e) => setF({ ...f, expectedCloseDate: e.target.value })}
          className={CHAMP}
        />
      </Champ>
      {erreur ? (
        <div className="sm:col-span-3">
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses('primary', 'md', 'self-end sm:col-span-3 sm:justify-self-start')}
      >
        {envoi ? 'Création…' : 'Créer l’opportunité'}
      </button>
    </form>
  );
}

export function CrmBoard(): React.ReactElement {
  const { actions } = useAccesVentes();
  const gerer = peutGererCrm(actions);
  const [board, setBoard] = useState<PipelineView | null>(null);
  const [vueListe, setVueListe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback(() => {
    crmApi
      .getPipeline()
      .then((b) => {
        setBoard(b);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Impossible de charger le pipeline.')));
  }, []);

  useEffect(() => charger(), [charger]);

  async function deplacer(o: OpportunitySummary, stageKey: string): Promise<void> {
    try {
      await crmApi.moveOpportunity(o.id, { expectedRevision: o.revision, stageKey });
      charger();
    } catch (err) {
      setErreur(messageCrm(err, 'Déplacement impossible.'));
    }
  }

  return (
    <section className="flex flex-col gap-5">
      <CrmNav />
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-pressed={!vueListe}
          onClick={() => setVueListe(false)}
        >
          Vue Kanban
        </button>
        <button
          type="button"
          className={BOUTON_PETIT}
          aria-pressed={vueListe}
          onClick={() => setVueListe(true)}
        >
          Vue liste
        </button>
        {gerer ? (
          <button type="button" className={BOUTON_PETIT} onClick={() => setCreation((c) => !c)}>
            {creation ? 'Fermer' : 'Nouvelle opportunité'}
          </button>
        ) : null}
      </div>
      {gerer && creation ? (
        <NouvelleOpportunite
          onCree={() => {
            setCreation(false);
            charger();
          }}
        />
      ) : null}

      {board === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement du pipeline…
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <section className="rounded-xl border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold">
                Relances en retard ({board.overdueActivities.length})
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {board.overdueActivities.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    <span className="font-medium text-[var(--danger)]">
                      {formatEcheance(a.dueAt)}
                    </span>{' '}
                    {ACTIVITY_LABELS[a.kind]} — {a.subject}
                    {a.opportunityId ? (
                      <>
                        {' '}
                        (
                        <Link
                          href={`${CRM_BASE}/${encodeURIComponent(a.opportunityId)}`}
                          className="underline"
                        >
                          {a.opportunityTitle ?? 'opportunité'}
                        </Link>
                        )
                      </>
                    ) : null}
                  </li>
                ))}
                {board.overdueActivities.length === 0 ? <li>Aucune.</li> : null}
              </ul>
            </section>
            <section className="rounded-xl border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold">Prochaines actions</h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {board.upcomingActivities.slice(0, 8).map((a) => (
                  <li key={a.id}>
                    {formatEcheance(a.dueAt)} — {ACTIVITY_LABELS[a.kind]} : {a.subject}
                  </li>
                ))}
                {board.upcomingActivities.length === 0 ? <li>Aucune action planifiée.</li> : null}
              </ul>
            </section>
            <section className="rounded-xl border border-[var(--border)] p-3">
              <h3 className="text-sm font-semibold">
                Inactives depuis {board.settings.staleAfterDays} jours ou plus ({board.stale.length}
                )
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {board.stale.slice(0, 8).map((o) => (
                  <li key={o.id}>
                    <Link href={`${CRM_BASE}/${encodeURIComponent(o.id)}`} className="underline">
                      {o.title}
                    </Link>{' '}
                    — {o.daysSinceActivity} j
                  </li>
                ))}
                {board.stale.length === 0 ? <li>Aucune.</li> : null}
              </ul>
            </section>
          </div>

          {vueListe ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Opportunités</caption>
              <thead>
                <tr className="text-left text-[var(--foreground-muted)]">
                  <th scope="col">Opportunité</th>
                  <th scope="col">Client ou prospect</th>
                  <th scope="col">Étape</th>
                  <th scope="col" className="text-right">
                    Montant estimé
                  </th>
                  <th scope="col">Dernière activité</th>
                </tr>
              </thead>
              <tbody>
                {board.stages.flatMap((s) =>
                  s.opportunities.map((o) => (
                    <tr key={o.id} className="border-t border-[var(--border)]">
                      <td>
                        <Link
                          href={`${CRM_BASE}/${encodeURIComponent(o.id)}`}
                          className="underline"
                        >
                          {o.title}
                        </Link>
                      </td>
                      <td>{interlocuteur(o)}</td>
                      <td>{o.stageLabel}</td>
                      <td className="text-right font-mono">{montantEstime(o)}</td>
                      <td>
                        {o.stale
                          ? `${o.daysSinceActivity} j (inactive)`
                          : `${o.daysSinceActivity} j`}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          ) : (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {board.stages.map((s) => (
                <section
                  key={s.key}
                  aria-label={`Étape ${s.label}`}
                  className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-[var(--border)] p-3"
                >
                  <h3 className="text-sm font-semibold">
                    {s.label}{' '}
                    <span className="text-[var(--foreground-muted)]">
                      ({s.opportunities.length})
                    </span>
                  </h3>
                  {totauxColonne(s.totals).map((t) => (
                    <p key={t} className="font-mono text-xs">
                      {t}
                    </p>
                  ))}
                  {s.winRate ? (
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {libelleProbabilite(s.winRate)}
                    </p>
                  ) : null}
                  <ul className="flex flex-col gap-2">
                    {s.opportunities.map((o) => (
                      <Carte
                        key={o.id}
                        o={o}
                        board={board}
                        gerer={gerer}
                        onMove={(x, k) => void deplacer(x, k)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          <p className="text-xs text-[var(--foreground-muted)]">
            Montants ESTIMÉS, totalisés par devise sans conversion ; ni réalisé ni prévision.
            Calculs du moteur, version {board.calculationVersion}.
          </p>
          {gerer ? (
            <CsvActions
              quoi="opportunités"
              colonnes="titre ; etape ; montant ; devise ; cloture_prevue ; prospect ; nif_client ; email_contact"
              exporter={crmApi.exportOpportunities}
              importer={crmApi.importOpportunities}
              onImporte={charger}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
