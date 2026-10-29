'use client';

// Pipeline du CRM — ADR-0040 § 6 et § 8.2 : Kanban par glisser-déposer natif
// (motif de `projets/_components/vue-kanban.tsx`, aucune dépendance), équivalent
// clavier (Espace saisit, ← → changent d'étape, Entrée dépose, Échap annule) et
// menu « Déplacer vers… » en secours ; vue liste ; filtre « Les miennes » ;
// prévision pondérée par devise étiquetée « estimé » ; encadrés relances en
// retard, inactives, orphelines. Sous 768 px : une colonne à la fois, menu seul.
//
// Chiffres recopiés de l'API (moteur) : rien n'est additionné ici.

import { Badge, buttonClasses } from '@lalanda/ui';
import { AlarmClock, KanbanSquare, Moon, Plus, UserX } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { crmApi, type OpportunitySummary, type PipelineView } from '@/lib/api-crm';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from '../../ventes/_components/form-ui';

import { useAccesCrm } from './crm-access';
import {
  ACTIVITY_LABELS,
  formatEcheance,
  formulaireOpportunite,
  interlocuteur,
  lienActivite,
  lienOpportunite,
  libelleProbabilite,
  messageCrm,
  montantEstime,
  peutGererCrm,
  preparerOpportunite,
  totauxColonne,
  type FormulaireOpportunite,
} from './crm-model';
import { CsvActions } from './crm-nav';
import { Bandeau, ChoixCompte, ChoixMembre, Panneau, TEINTE_RUN, Tuile } from './crm-ui';
import { BoiteMotifPerte, type DemandeMotif } from './motif-perte';
import {
  MENTION_ESTIME,
  annonceDepot,
  deplacable,
  filtreResponsableParDefaut,
  libelleResponsable,
  lignesPrevision,
  nomMembre,
  requetePipeline,
  suiteDepot,
  toucheKanban,
  type FiltreResponsable,
  type Saisie,
} from './pipeline-model';

const TYPE_GLISSE = 'application/x-lalanda-opportunite';

type Deplacer = (o: OpportunitySummary, stageKey: string) => void;

function Carte({
  o,
  board,
  gerer,
  saisie,
  onClavier,
  onDeplacer,
  onGlisse,
}: {
  o: OpportunitySummary;
  board: PipelineView;
  gerer: boolean;
  saisie: Saisie | null;
  onClavier: (o: OpportunitySummary, touche: string) => boolean;
  onDeplacer: Deplacer;
  onGlisse: (id: string | null) => void;
}): React.ReactElement {
  const { membres } = useAccesCrm();
  const mobile = deplacable(o, gerer);
  const saisie_ = saisie?.opportunityId === o.id;
  return (
    <li
      tabIndex={mobile ? 0 : undefined}
      draggable={mobile}
      aria-roledescription={mobile ? 'carte déplaçable' : undefined}
      aria-describedby={mobile ? 'aide-kanban' : undefined}
      onDragStart={(e) => {
        e.dataTransfer.setData(TYPE_GLISSE, o.id);
        e.dataTransfer.effectAllowed = 'move';
        onGlisse(o.id);
      }}
      onDragEnd={() => onGlisse(null)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (onClavier(o, e.key)) e.preventDefault();
      }}
      className={`flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-md)] border bg-[var(--surface)] p-3 text-sm shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--accent)] ${
        saisie_
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]'
          : 'border-[var(--border)] hover:border-[var(--module-run)]'
      } ${mobile ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <Link
        href={lienOpportunite(o.id)}
        className="font-medium break-words underline-offset-2 hover:underline"
      >
        {o.title}
      </Link>
      <span className="text-xs break-words text-[var(--foreground-muted)]">{interlocuteur(o)}</span>
      <span className="font-mono text-xs">{montantEstime(o)}</span>
      <span className="text-xs text-[var(--foreground-muted)]">
        {libelleResponsable(o, membres)}
      </span>
      <span className="flex flex-wrap gap-1">
        {o.orphaned ? <Badge tone="danger">Orpheline</Badge> : null}
        {o.stale ? <Badge tone="warning">Inactive depuis {o.daysSinceActivity} j</Badge> : null}
      </span>
      {mobile ? (
        <label className="mt-1 flex flex-col gap-1 text-xs">
          <span className="text-[var(--foreground-muted)]">Déplacer vers…</span>
          <select
            className={`${CHAMP} py-1 text-xs`}
            value={o.stageKey}
            aria-label={`Déplacer « ${o.title} » vers une autre étape`}
            onChange={(e) => onDeplacer(o, e.target.value)}
          >
            {board.settings.stages.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </li>
  );
}

function NouvelleOpportunite({ onCree }: { onCree: () => void }): React.ReactElement {
  const { membres } = useAccesCrm();
  const [f, setF] = useState<FormulaireOpportunite>(formulaireOpportunite());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

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
      className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-3"
      noValidate
    >
      <h3 className="text-sm font-semibold sm:col-span-2 lg:col-span-3">Nouvelle opportunité</h3>
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
      <Champ id="op-compte" label="Compte" requis erreur={champs['accountId']}>
        <ChoixCompte
          id="op-compte"
          valeur={f.accountId}
          onChange={(accountId) => setF({ ...f, accountId })}
          aria={aria('op-compte', champs['accountId'])}
        />
      </Champ>
      <Champ id="op-responsable" label="Responsable">
        <ChoixMembre
          id="op-responsable"
          valeur={f.ownerId}
          membres={membres}
          onChange={(ownerId) => setF({ ...f, ownerId })}
        />
      </Champ>
      <Champ
        id="op-montant"
        label="Montant estimé"
        aide="Facultatif ; il peut aussi être tiré des lignes d’articles sur la fiche."
        erreur={champs['amount']}
      >
        <input
          id="op-montant"
          inputMode="decimal"
          value={f.montant}
          onChange={(e) => setF({ ...f, montant: e.target.value })}
          placeholder="1 500,00"
          className={CHAMP}
          {...aria('op-montant', champs['amount'], true)}
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
        <div className="sm:col-span-2 lg:col-span-3">
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses(
          'primary',
          'md',
          'sm:col-span-2 sm:justify-self-start lg:col-span-3',
        )}
      >
        {envoi ? 'Création…' : 'Créer l’opportunité'}
      </button>
    </form>
  );
}

function Prevision({ board }: { board: PipelineView }): React.ReactElement {
  const lignes = lignesPrevision(board.forecast);
  return (
    <section
      aria-labelledby="prevision-titre"
      className={`flex flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] p-4 sm:p-5 ${TEINTE_RUN}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="prevision-titre" className="text-sm font-semibold">
          Prévision pondérée <Badge tone="info">estimé</Badge>
        </h3>
        <span className="text-xs text-[var(--foreground-muted)]">
          Probabilités{' '}
          {board.forecast.probabilitySource === 'historical' ? 'historiques' : 'saisies'} par étape
        </span>
      </div>
      {lignes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucune opportunité ouverte : rien à prévoir pour l’instant.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lignes.map((l) => (
            <li key={l.currency} className="flex flex-col gap-1">
              <Tuile
                libelle={`Pondéré · ${l.currency}`}
                valeur={l.pondere}
                detail={`Montant brut ${l.brut} · ${l.detail}`}
              />
              {l.nonPonderable ? (
                <p className="text-xs text-[var(--foreground-muted)]">{l.nonPonderable}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-[var(--foreground-muted)]">
        {MENTION_ESTIME} Chaque devise est présentée à part, sans conversion. Moteur, version{' '}
        {board.forecast.version}.
      </p>
    </section>
  );
}

function Orphelines({
  board,
  gerer,
  onReassigne,
}: {
  board: PipelineView;
  gerer: boolean;
  onReassigne: () => void;
}): React.ReactElement {
  const { membres } = useAccesCrm();
  const [cible, setCible] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const orphelines = board.stages.flatMap((s) => s.opportunities.filter((o) => o.orphaned));
  return (
    <Panneau titre={`Orphelines (${board.orphaned.count})`} icone={UserX} id="orphelines">
      {board.orphaned.count === 0 ? (
        <p className="text-sm">Aucune : chaque opportunité ouverte a un responsable.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {orphelines.slice(0, 6).map((o) => (
              <li key={o.id}>
                <Link href={lienOpportunite(o.id)} className="underline">
                  {o.title}
                </Link>
              </li>
            ))}
          </ul>
          {gerer ? (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (cible === '') return;
                setErreur(null);
                void Promise.all(
                  board.orphaned.ownerIds.map((fromOwnerId) =>
                    crmApi.reassignOpportunities({ fromOwnerId, toOwnerId: cible, onlyOpen: true }),
                  ),
                )
                  .then((r) => {
                    const n = r.reduce((acc, x) => acc + x.reassigned, 0);
                    setInfo(`${n} opportunité${n > 1 ? 's' : ''} réassignée${n > 1 ? 's' : ''}.`);
                    onReassigne();
                  })
                  .catch((err) => setErreur(messageCrm(err, 'Réassignation impossible.')));
              }}
            >
              <label htmlFor="reassigner" className="text-xs text-[var(--foreground-muted)]">
                Réassigner toutes les orphelines à
              </label>
              <div className="flex flex-wrap gap-2">
                <div className="min-w-0 flex-1">
                  <ChoixMembre
                    id="reassigner"
                    valeur={cible}
                    membres={membres}
                    vide="Choisir un membre…"
                    onChange={setCible}
                  />
                </div>
                <button type="submit" className={BOUTON_PETIT} disabled={cible === ''}>
                  Réassigner
                </button>
              </div>
              {info ? (
                <p role="status" className="text-xs">
                  {info}
                </p>
              ) : null}
              {erreur ? <p className="text-xs text-[var(--danger)]">{erreur}</p> : null}
            </form>
          ) : null}
        </>
      )}
    </Panneau>
  );
}

export function CrmBoard(): React.ReactElement {
  const { actions, membres } = useAccesCrm();
  const gerer = peutGererCrm(actions);
  const [board, setBoard] = useState<PipelineView | null>(null);
  const [vueListe, setVueListe] = useState(false);
  const [filtre, setFiltre] = useState<FiltreResponsable | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [glisse, setGlisse] = useState<string | null>(null);
  const [survol, setSurvol] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState('');
  const [motif, setMotif] = useState<DemandeMotif | null>(null);
  const [gagnee, setGagnee] = useState<OpportunitySummary | null>(null);
  const [colonneMobile, setColonneMobile] = useState<string | null>(null);

  // Filtre par défaut quand les droits sont connus (§ 6.1) : un confort, pas un contrôle.
  useEffect(() => {
    if (filtre === null && actions !== null) setFiltre(filtreResponsableParDefaut(actions));
  }, [actions, filtre]);

  const charger = useCallback(() => {
    if (filtre === null) return;
    crmApi
      .getPipeline(requetePipeline(filtre))
      .then((b) => {
        setBoard(b);
        setErreur(null);
      })
      .catch((err) => setErreur(messageCrm(err, 'Impossible de charger le pipeline.')));
  }, [filtre]);

  useEffect(() => charger(), [charger]);

  async function envoyer(
    o: OpportunitySummary,
    stageKey: string,
    motifCorps: { lostReasonKey: string | null; lostReasonDetail: string | null } | null,
  ): Promise<void> {
    if (!board) return;
    try {
      await crmApi.moveOpportunity(o.id, {
        expectedRevision: o.revision,
        stageKey,
        ...(motifCorps ?? {}),
      });
      setAnnonce(annonceDepot(o.title, board.settings.stages, stageKey));
      if (suiteDepot(board.settings.stages, stageKey) === 'gagne') setGagnee(o);
      charger();
    } catch (err) {
      setErreur(messageCrm(err, 'Déplacement impossible.'));
      charger();
    }
  }

  const deplacer: Deplacer = (o, stageKey) => {
    if (!board || stageKey === o.stageKey) return;
    if (suiteDepot(board.settings.stages, stageKey) === 'motif') {
      setMotif({
        titre: o.title,
        valider: (corps) => {
          setMotif(null);
          void envoyer(o, stageKey, corps);
        },
        annuler: () => {
          setMotif(null);
          setAnnonce(`Déplacement de « ${o.title} » annulé.`);
        },
      });
      return;
    }
    void envoyer(o, stageKey, null);
  };

  function clavier(o: OpportunitySummary, touche: string): boolean {
    if (!board || !deplacable(o, gerer)) return false;
    const r = toucheKanban(board.settings.stages, o, saisie, touche);
    switch (r.type) {
      case 'rien':
        return false;
      case 'saisie':
      case 'deplace':
        setSaisie(r.saisie);
        setAnnonce(r.annonce);
        return true;
      case 'annule':
        setSaisie(null);
        setAnnonce(r.annonce);
        return true;
      case 'depot':
        setSaisie(null);
        deplacer(o, r.saisie.cible);
        return true;
    }
  }

  const toutes = board ? board.stages.flatMap((s) => s.opportunities) : [];
  const colonneVisible = colonneMobile ?? board?.stages[0]?.key ?? null;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={KanbanSquare}
        titre="Pipeline"
        sousTitre={
          board
            ? `${toutes.length} opportunité${toutes.length > 1 ? 's' : ''} affichée${toutes.length > 1 ? 's' : ''}${board.ownerId ? ' · les miennes' : ''}`
            : 'Chargement…'
        }
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => setCreation((c) => !c)}
              aria-expanded={creation}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              {creation ? 'Fermer' : 'Nouvelle opportunité'}
            </button>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Affichage">
          <button
            type="button"
            className={BOUTON_PETIT}
            aria-pressed={filtre === 'tous'}
            onClick={() => setFiltre('tous')}
          >
            Tout le pipeline
          </button>
          <button
            type="button"
            className={BOUTON_PETIT}
            aria-pressed={filtre === 'miennes'}
            onClick={() => setFiltre('miennes')}
          >
            Mes opportunités
          </button>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-[var(--border)]" />
          <button
            type="button"
            className={BOUTON_PETIT}
            aria-pressed={!vueListe}
            onClick={() => setVueListe(false)}
          >
            Kanban
          </button>
          <button
            type="button"
            className={BOUTON_PETIT}
            aria-pressed={vueListe}
            onClick={() => setVueListe(true)}
          >
            Liste
          </button>
        </div>
      </Bandeau>

      <p className="sr-only" aria-live="polite" role="status">
        {annonce}
      </p>
      <p id="aide-kanban" className="sr-only">
        Espace pour saisir la carte, flèches gauche et droite pour changer d’étape, Entrée pour
        déposer, Échap pour annuler.
      </p>

      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {gerer && creation ? (
        <NouvelleOpportunite
          onCree={() => {
            setCreation(false);
            charger();
          }}
        />
      ) : null}
      {gagnee ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,var(--surface))] p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            <strong>« {gagnee.title} » est gagnée.</strong> Ouvrez sa fiche pour préparer le devis
            ou le projet.
          </p>
          <div className="flex gap-2">
            <Link href={lienOpportunite(gagnee.id)} className={buttonClasses('primary', 'sm')}>
              Ouvrir la fiche
            </Link>
            <button type="button" className={BOUTON_PETIT} onClick={() => setGagnee(null)}>
              Fermer
            </button>
          </div>
        </div>
      ) : null}

      {board === null ? (
        <p className="text-sm text-[var(--foreground-muted)]" aria-live="polite">
          Chargement du pipeline…
        </p>
      ) : (
        <>
          <Prevision board={board} />

          <div className="grid gap-3 md:grid-cols-3">
            <Panneau
              titre={`Relances en retard (${board.overdueActivities.length})`}
              icone={AlarmClock}
              id="relances-retard"
              action={
                <Link href="/crm/activites" className="text-xs underline underline-offset-2">
                  Toutes les activités
                </Link>
              }
            >
              <ul className="flex flex-col gap-1 text-sm">
                {board.overdueActivities.slice(0, 6).map((a) => (
                  <li key={a.id} className="break-words">
                    <span className="font-medium text-[var(--danger)]">
                      {formatEcheance(a.dueAt)}
                    </span>{' '}
                    <Link href={lienActivite(a.id)} className="underline-offset-2 hover:underline">
                      {ACTIVITY_LABELS[a.kind]} — {a.subject}
                    </Link>
                  </li>
                ))}
                {board.overdueActivities.length === 0 ? <li>Aucune.</li> : null}
              </ul>
            </Panneau>
            <Panneau
              titre={`Inactives depuis ${board.settings.staleAfterDays} j ou plus (${board.stale.length})`}
              icone={Moon}
              id="inactives"
            >
              <ul className="flex flex-col gap-1 text-sm">
                {board.stale.slice(0, 6).map((o) => (
                  <li key={o.id} className="break-words">
                    <Link href={lienOpportunite(o.id)} className="underline">
                      {o.title}
                    </Link>{' '}
                    — {o.daysSinceActivity} j
                  </li>
                ))}
                {board.stale.length === 0 ? <li>Aucune.</li> : null}
              </ul>
            </Panneau>
            <Orphelines board={board} gerer={gerer} onReassigne={charger} />
          </div>

          {vueListe ? (
            <div className="min-w-0 overflow-x-auto rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Opportunités</caption>
                <thead>
                  <tr className="text-left text-xs text-[var(--foreground-muted)]">
                    <th scope="col" className="px-3 py-2">
                      Opportunité
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Compte
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Étape
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Responsable
                    </th>
                    <th scope="col" className="px-3 py-2 text-right">
                      Montant estimé
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Dernière activité
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {toutes.map((o) => (
                    <tr key={o.id} className="border-t border-[var(--border)]">
                      <td className="px-3 py-2">
                        <Link href={lienOpportunite(o.id)} className="underline">
                          {o.title}
                        </Link>
                      </td>
                      <td className="px-3 py-2">{interlocuteur(o)}</td>
                      <td className="px-3 py-2">{o.stageLabel}</td>
                      <td className="px-3 py-2">
                        {o.orphaned ? 'À réassigner' : nomMembre(membres, o.ownerId)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{montantEstime(o)}</td>
                      <td className="px-3 py-2">
                        {o.stale
                          ? `${o.daysSinceActivity} j (inactive)`
                          : `${o.daysSinceActivity} j`}
                      </td>
                    </tr>
                  ))}
                  {toutes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center">
                        Aucune opportunité.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <label className="flex flex-col gap-1 text-sm md:hidden">
                Étape affichée
                <select
                  className={CHAMP}
                  value={colonneVisible ?? ''}
                  onChange={(e) => setColonneMobile(e.target.value)}
                >
                  {board.stages.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({s.opportunities.length})
                    </option>
                  ))}
                </select>
              </label>
              {/* Le tableau défile À L'INTÉRIEUR de sa zone : la page ne déborde pas. */}
              <div className="relative min-w-0 overflow-x-auto pb-2">
                <div className="flex gap-3">
                  {board.stages.map((s) => {
                    const cibleClavier = saisie?.cible === s.key;
                    return (
                      <section
                        key={s.key}
                        aria-label={`Étape ${s.label}`}
                        onDragOver={(e) => {
                          if (!glisse || !gerer) return;
                          e.preventDefault();
                          e.dataTransfer.dropEffect = 'move';
                          setSurvol(s.key);
                        }}
                        onDragLeave={() => setSurvol((v) => (v === s.key ? null : v))}
                        onDrop={(e) => {
                          e.preventDefault();
                          setSurvol(null);
                          const id = e.dataTransfer.getData(TYPE_GLISSE) || glisse;
                          setGlisse(null);
                          const o = toutes.find((x) => x.id === id);
                          if (o && deplacable(o, gerer)) deplacer(o, s.key);
                        }}
                        className={`${s.key === colonneVisible ? 'flex' : 'hidden'} w-full shrink-0 flex-col gap-2 rounded-[var(--radius-lg)] border p-3 transition md:flex md:w-72 ${
                          survol === s.key || cibleClavier
                            ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                            : `border-[var(--border)] ${TEINTE_RUN}`
                        }`}
                      >
                        <h3 className="flex items-center justify-between gap-2 text-sm font-semibold">
                          <span>{s.label}</span>
                          <Badge
                            tone={
                              s.kind === 'won'
                                ? 'success'
                                : s.kind === 'lost'
                                  ? 'danger'
                                  : 'neutral'
                            }
                          >
                            {s.opportunities.length}
                          </Badge>
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
                        <ul className="flex min-h-12 flex-col gap-2">
                          {s.opportunities.map((o) => (
                            <Carte
                              key={o.id}
                              o={o}
                              board={board}
                              gerer={gerer}
                              saisie={saisie}
                              onClavier={clavier}
                              onDeplacer={deplacer}
                              onGlisse={setGlisse}
                            />
                          ))}
                          {s.opportunities.length === 0 ? (
                            <li className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3 text-center text-xs text-[var(--foreground-muted)]">
                              Aucune opportunité
                            </li>
                          ) : null}
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </div>
            </>
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
          <BoiteMotifPerte demande={motif} settings={board.settings} />
        </>
      )}
    </section>
  );
}
