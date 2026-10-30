'use client';

// `/projets` — liste des projets (ADR-0039 § 8) : filtres statut, nature,
// recherche ; « Nouveau projet » pour `work.manage`, avec client, opportunité et
// devis liés (contrat `CreateWorkProjectBody.links`). Compteurs et prochain
// jalon viennent de l'API (`WorkProjectSummary`) ; rien n'est recalculé ici.

import type { WorkProjectKind, WorkProjectStatus, WorkProjectSummary } from '@lalanda/shared/work';
import { Badge, EmptyState, Modal, PageHeader, Skeleton, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';
import { crmApi, type OpportunitySummary, type QuoteSummary } from '@/lib/api-crm';
import { workApi, type WorkMemberOption } from '@/lib/work-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, Responsable, aria } from './elements';
import {
  MES_TACHES_HREF,
  NATURES_PROJET,
  STATUTS_PROJET,
  aujourdhui,
  formatJour,
  formulaireProjet,
  hrefProjet,
  messageWork,
  peutGerer,
  preparerProjet,
  progression,
  type FormulaireProjet,
} from './projets-model';

function NouveauProjet({ onAnnule }: { onAnnule: () => void }): React.ReactElement {
  const router = useRouter();
  const { actions } = useShell();
  const [f, setF] = useState<FormulaireProjet>(formulaireProjet());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [clients, setClients] = useState<CustomerView[]>([]);
  const [opportunites, setOpportunites] = useState<OpportunitySummary[]>([]);
  const [devis, setDevis] = useState<QuoteSummary[]>([]);
  const ventes = actions?.includes('sales.read') ?? false;
  const crm = actions?.includes('crm.read') ?? false;

  useEffect(() => {
    workApi
      .listMembers()
      .then((r) => setMembres(r.filter((m) => m.canUpdate)))
      .catch(() => setMembres([]));
    // Listes de liaison : seulement si le rôle les lit (sinon l'API répondrait 403).
    if (ventes) {
      api
        .listCustomers({ status: 'active', limit: 100 })
        .then((p) => setClients(p.items))
        .catch(() => undefined);
      crmApi
        .listQuotes({ status: 'accepted', limit: 100 })
        .then((p) => setDevis(p.items))
        .catch(() => undefined);
    }
    if (crm) {
      crmApi
        .listOpportunities({ status: 'open', limit: 100 })
        .then((p) => setOpportunites(p.items))
        .catch(() => undefined);
    }
  }, [ventes, crm]);

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const p = preparerProjet(f);
    if (!p.ok) {
      setChamps(p.champs);
      return;
    }
    setEnvoi(true);
    setErreur(null);
    setChamps({});
    try {
      const projet = await workApi.createProject(p.corps);
      router.push(hrefProjet(projet.id));
    } catch (err) {
      setErreur(messageWork(err, 'Création impossible.'));
      setEnvoi(false);
    }
  }

  const client = f.kind === 'client';
  const devisDuClient = f.customerId ? devis.filter((q) => q.customerId === f.customerId) : devis;

  return (
    <form
      onSubmit={(e) => void creer(e)}
      noValidate
      aria-label="Nouveau projet"
      className="grid gap-4 sm:grid-cols-2"
    >
      <Champ id="pj-nom" label="Nom du projet" requis erreur={champs['name']}>
        <input
          id="pj-nom"
          value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })}
          className={CHAMP}
          maxLength={120}
          autoFocus
          {...aria('pj-nom', champs['name'])}
        />
      </Champ>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Nature</legend>
        <div className="flex flex-wrap gap-4 pt-1.5 text-sm">
          {(['client', 'internal'] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <input
                type="radio"
                name="pj-nature"
                value={k}
                checked={f.kind === k}
                onChange={() => setF({ ...f, kind: k })}
              />
              {NATURES_PROJET[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <Champ id="pj-resp" label="Responsable du projet" erreur={champs['ownerUserId']}>
        <select
          id="pj-resp"
          value={f.ownerUserId}
          onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}
          className={CHAMP}
        >
          <option value="">Aucun pour l’instant</option>
          {membres.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </Champ>
      <div className="grid grid-cols-2 gap-3">
        <Champ id="pj-debut" label="Début" erreur={champs['startDate']}>
          <input
            id="pj-debut"
            type="date"
            value={f.startDate}
            onChange={(e) => setF({ ...f, startDate: e.target.value })}
            className={CHAMP}
            {...aria('pj-debut', champs['startDate'])}
          />
        </Champ>
        <Champ id="pj-fin" label="Échéance" erreur={champs['dueDate']}>
          <input
            id="pj-fin"
            type="date"
            value={f.dueDate}
            onChange={(e) => setF({ ...f, dueDate: e.target.value })}
            className={CHAMP}
            {...aria('pj-fin', champs['dueDate'])}
          />
        </Champ>
      </div>
      {client && ventes ? (
        <>
          <Champ id="pj-client" label="Client" erreur={champs['customerId']}>
            <select
              id="pj-client"
              value={f.customerId}
              onChange={(e) => setF({ ...f, customerId: e.target.value, quoteId: '' })}
              className={CHAMP}
            >
              <option value="">Aucun</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Champ>
          <Champ
            id="pj-devis"
            label="Devis accepté"
            aide="Le devis reste la référence des montants : aucun montant n’est recopié dans le projet."
            erreur={champs['quoteId']}
          >
            <select
              id="pj-devis"
              value={f.quoteId}
              onChange={(e) => setF({ ...f, quoteId: e.target.value })}
              className={CHAMP}
              {...aria('pj-devis', champs['quoteId'], true)}
            >
              <option value="">Aucun</option>
              {devisDuClient.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.number}
                  {q.title ? ` — ${q.title}` : ''}
                  {q.customerName ? ` (${q.customerName})` : ''}
                </option>
              ))}
            </select>
          </Champ>
        </>
      ) : null}
      {client && crm ? (
        <Champ id="pj-opp" label="Opportunité" erreur={champs['opportunityId']}>
          <select
            id="pj-opp"
            value={f.opportunityId}
            onChange={(e) => setF({ ...f, opportunityId: e.target.value })}
            className={CHAMP}
          >
            <option value="">Aucune</option>
            {opportunites.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
        </Champ>
      ) : null}
      <div className="sm:col-span-2">
        <Champ id="pj-desc" label="Description" erreur={champs['description']}>
          <textarea
            id="pj-desc"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            className={CHAMP}
            rows={3}
            maxLength={5000}
          />
        </Champ>
      </div>
      <p className="text-xs text-[var(--foreground-muted)] sm:col-span-2">
        Les colonnes du Kanban sont celles proposées par défaut ; vous pourrez les renommer, en
        ajouter ou les réordonner dans les Réglages du projet.
      </p>
      {erreur ? (
        <div className="sm:col-span-2">
          <Alerte>
            <p>{erreur}</p>
          </Alerte>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" disabled={envoi} className={buttonClasses('primary', 'md')}>
          {envoi ? 'Création…' : 'Créer le projet'}
        </button>
        <button type="button" onClick={onAnnule} className={buttonClasses('secondary', 'md')}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function CarteProjet({ p, today }: { p: WorkProjectSummary; today: string }): React.ReactElement {
  const prog = progression(p);
  return (
    // Carte entièrement cliquable : le lien du nom est étiré sur toute la carte.
    <li className="relative flex min-w-0 flex-col gap-3 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 transition hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <Link
          href={hrefProjet(p.id)}
          className="min-w-0 break-words font-display text-base font-semibold underline-offset-2 hover:underline after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
        >
          {p.name}
        </Link>
        <Badge tone={p.status === 'active' ? 'info' : 'neutral'}>{STATUTS_PROJET[p.status]}</Badge>
      </div>
      <p className="text-xs text-[var(--foreground-muted)]">
        {NATURES_PROJET[p.kind]}
        {p.customerName ? ` · ${p.customerName}` : ''}
      </p>
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-hidden="true"
          className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--surface-muted)]"
        >
          <span
            className="block h-full bg-[var(--module-run)]"
            style={{ width: `${prog.pourcent}%` }}
          />
        </span>
        <span className="text-[var(--foreground-muted)]">{prog.texte}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {p.overdueTaskCount > 0 ? (
          <Badge tone="danger">{p.overdueTaskCount} en retard</Badge>
        ) : null}
        {p.nextMilestone ? (
          <Badge tone={p.nextMilestone.dueDate < today ? 'danger' : 'neutral'}>
            <span aria-hidden="true">◆</span> Jalon « {p.nextMilestone.title} » ·{' '}
            {formatJour(p.nextMilestone.dueDate, false)}
          </Badge>
        ) : null}
        {p.dueDate ? (
          <span className="text-[var(--foreground-muted)]">Fin prévue {formatJour(p.dueDate)}</span>
        ) : null}
      </div>
      <Responsable name={p.owner?.name ?? null} />
    </li>
  );
}

type FiltreStatut = '' | WorkProjectStatus;

export function ListeProjets(): React.ReactElement {
  const { actions } = useShell();
  const gerer = peutGerer(actions);
  const [statut, setStatut] = useState<FiltreStatut>('');
  const [nature, setNature] = useState<'' | WorkProjectKind>('');
  const [q, setQ] = useState('');
  const [recherche, setRecherche] = useState('');
  const [items, setItems] = useState<WorkProjectSummary[] | null>(null);
  const [curseur, setCurseur] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);
  const today = aujourdhui();

  const charger = useCallback(
    (suite: string | null) => {
      workApi
        .listProjects({
          ...(statut ? { status: statut } : {}),
          ...(nature ? { kind: nature } : {}),
          ...(recherche ? { q: recherche } : {}),
          cursor: suite,
        })
        .then((page) => {
          setItems((avant) => (suite && avant ? [...avant, ...page.items] : page.items));
          setCurseur(page.nextCursor);
          setErreur(null);
        })
        .catch((err: unknown) => setErreur(messageWork(err, 'Impossible de charger les projets.')));
    },
    [statut, nature, recherche],
  );

  useEffect(() => {
    setItems(null);
    charger(null);
  }, [charger]);

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Projets"
        description="Projets clients et internes : tâches, responsables, échéances, Kanban. Les projets archivés sont masqués par défaut."
        actions={
          <>
            <Link href={MES_TACHES_HREF} className={buttonClasses('secondary', 'md')}>
              Mes tâches
            </Link>
            {gerer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'md')}
                onClick={() => setCreation(true)}
              >
                Nouveau projet
              </button>
            ) : null}
          </>
        }
      />
      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouveau projet"
        size="lg"
      >
        <NouveauProjet onAnnule={() => setCreation(false)} />
      </Modal>

      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setRecherche(q.trim());
        }}
      >
        <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1.5">
          <label htmlFor="pj-q" className="text-sm font-medium">
            Rechercher
          </label>
          <input
            id="pj-q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => setRecherche(q.trim())}
            className={CHAMP}
            maxLength={100}
            placeholder="Nom du projet"
          />
        </div>
        <div className="flex basis-36 flex-col gap-1.5">
          <label htmlFor="pj-statut" className="text-sm font-medium">
            Statut
          </label>
          <select
            id="pj-statut"
            value={statut}
            onChange={(e) => setStatut(e.target.value as FiltreStatut)}
            className={CHAMP}
          >
            <option value="">Non archivés</option>
            {(Object.keys(STATUTS_PROJET) as WorkProjectStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUTS_PROJET[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex basis-36 flex-col gap-1.5">
          <label htmlFor="pj-nature-f" className="text-sm font-medium">
            Nature
          </label>
          <select
            id="pj-nature-f"
            value={nature}
            onChange={(e) => setNature(e.target.value as '' | WorkProjectKind)}
            className={CHAMP}
          >
            <option value="">Toutes</option>
            <option value="client">Clients</option>
            <option value="internal">Internes</option>
          </select>
        </div>
      </form>

      {erreur ? (
        <Alerte
          action={
            <button type="button" className={BOUTON_PETIT} onClick={() => charger(null)}>
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {items === null ? (
        erreur ? null : (
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Skeleton className="h-40 rounded-[var(--radius-lg)]" />
              </li>
            ))}
          </ul>
        )
      ) : items.length === 0 ? (
        <EmptyState
          title={recherche || statut || nature ? 'Aucun projet ne correspond' : 'Aucun projet'}
          description={
            gerer
              ? 'Créez un projet client ou interne pour y organiser les tâches de l’équipe.'
              : 'Un Propriétaire, un Administrateur ou un Dirigeant peut créer le premier projet.'
          }
          action={
            gerer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'md')}
                onClick={() => setCreation(true)}
              >
                Nouveau projet
              </button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {items.map((p) => (
              <CarteProjet key={p.id} p={p} today={today} />
            ))}
          </ul>
          {curseur ? (
            <button
              type="button"
              className={buttonClasses('secondary', 'md', 'self-center')}
              onClick={() => charger(curseur)}
            >
              Afficher plus
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
