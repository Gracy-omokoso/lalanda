'use client';

// `/projets` — accueil des projets façon Asana (ADR-0058) : chiffres de
// l'organisation, filtres Mes projets · Tous · Archivés, recherche, tableau dense
// (cartes sur téléphone) avec pastille, statut de santé, avancement, membres,
// échéance et retards ; « Nouveau projet » pour `work.manage`, avec client,
// opportunité et devis liés (ADR-0039 § 8). Tout vient de `GET /work/portfolio` :
// rien n'est recalculé ici.

import type {
  WorkPortfolioProject,
  WorkPortfolioScope,
  WorkPortfolioView,
} from '@lalanda/shared/work';
import { EmptyState, Modal, PageHeader, Skeleton, StatusPill, buttonClasses } from '@lalanda/ui';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';
import { crmApi, type OpportunitySummary, type QuoteSummary } from '@/lib/api-crm';
import { workApi, type WorkMemberOption } from '@/lib/work-api';
import { workPortfolioApi } from '@/lib/work-portfolio-api';

import { useShell } from '../../_components/shell-context';

import { Alerte, BOUTON_PETIT, CHAMP, Champ, aria } from './elements';
import { PastilleProjet, PileAvatars } from './equipe-elements';
import { ChoixCreation } from './import-entrees';
import {
  FILTRES_PORTEFEUILLE,
  cartesPortefeuille,
  etatVide,
  filtrerProjets,
  raisonSante,
  statutAffiche,
  texteAvancement,
} from './portefeuille-model';
import {
  MES_TACHES_HREF,
  NATURES_PROJET,
  formatJour,
  formulaireProjet,
  hrefProjet,
  messageWork,
  peutGerer,
  preparerProjet,
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

const CARTE = 'rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)]';

/** Barre d'avancement (pourcentage rendu par l'API) ; le texte l'accompagne toujours. */
function Avancement({ p }: { p: WorkPortfolioProject }): React.ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs">
      <span
        aria-hidden="true"
        className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--surface-muted)]"
      >
        <span
          className="block h-full origin-left rounded-full bg-[var(--chart-1)] chart-grow"
          style={{ width: `${p.progressPercent}%` }}
        />
      </span>
      <span className="whitespace-nowrap tabular-nums text-[var(--foreground-muted)]">
        {texteAvancement(p)}
      </span>
    </span>
  );
}

function Statut({ p }: { p: WorkPortfolioProject }): React.ReactElement {
  const s = statutAffiche(p);
  return (
    <StatusPill tone={s.ton} title={raisonSante(p)}>
      {s.libelle}
      <span className="sr-only"> — {raisonSante(p)}</span>
    </StatusPill>
  );
}

function EcheanceProjet({
  p,
  today,
}: {
  p: WorkPortfolioProject;
  today: string;
}): React.ReactElement {
  if (!p.dueDate) return <span className="text-xs text-[var(--foreground-muted)]">—</span>;
  const depassee = p.health !== 'closed' && p.dueDate < today;
  return (
    <span
      className={`whitespace-nowrap text-xs tabular-nums ${depassee ? 'font-medium text-[var(--danger)]' : 'text-[var(--foreground-muted)]'}`}
    >
      {formatJour(p.dueDate)}
      {depassee ? <span className="sr-only"> (dépassée)</span> : null}
    </span>
  );
}

function Retards({ n }: { n: number }): React.ReactElement {
  return n > 0 ? (
    <span className="whitespace-nowrap text-xs font-medium tabular-nums text-[var(--danger)]">
      {n} en retard
    </span>
  ) : (
    <span className="text-xs text-[var(--foreground-muted)]">
      <span aria-hidden="true">—</span>
      <span className="sr-only">aucune tâche en retard</span>
    </span>
  );
}

/** Tableau dense (écran large) : une ligne par projet, toute la ligne ouvre le projet. */
function TableauProjets({
  items,
  today,
}: {
  items: readonly WorkPortfolioProject[];
  today: string;
}): React.ReactElement {
  return (
    <div className={`${CARTE} overflow-hidden max-md:hidden`}>
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">Projets, avec leur statut, avancement et échéance</caption>
        <thead>
          <tr className="border-b border-[var(--border)] text-left text-xs font-medium text-[var(--foreground-muted)]">
            <th scope="col" className="w-[34%] px-4 py-2 font-medium">
              Projet
            </th>
            <th scope="col" className="w-[15%] px-2 py-2 font-medium">
              Statut
            </th>
            <th scope="col" className="w-[18%] px-2 py-2 font-medium">
              Avancement
            </th>
            <th scope="col" className="w-[12%] px-2 py-2 font-medium">
              Membres
            </th>
            <th scope="col" className="w-[11%] px-2 py-2 font-medium">
              Échéance
            </th>
            <th scope="col" className="w-[10%] px-2 py-2 pr-4 font-medium">
              Retards
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {items.map((p) => (
            <tr
              key={p.id}
              className="relative h-[var(--row-h)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] motion-reduce:transition-none"
            >
              <td className="px-4 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <PastilleProjet couleur={p.color} />
                  <span className="flex min-w-0 flex-col">
                    <Link
                      href={hrefProjet(p.id)}
                      className="truncate font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <span className="truncate text-xs text-[var(--foreground-muted)]">
                      {p.customerName ?? NATURES_PROJET[p.kind]}
                    </span>
                  </span>
                </span>
              </td>
              <td className="px-2 py-2">
                <Statut p={p} />
              </td>
              <td className="px-2 py-2">
                <Avancement p={p} />
              </td>
              <td className="px-2 py-2">
                <PileAvatars membres={p.members} total={p.memberCount} />
              </td>
              <td className="px-2 py-2">
                <EcheanceProjet p={p} today={today} />
              </td>
              <td className="px-2 py-2 pr-4">
                <Retards n={p.overdueTaskCount} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Cartes (téléphone et tablette) : mêmes informations, empilées. */
function CartesProjets({
  items,
  today,
}: {
  items: readonly WorkPortfolioProject[];
  today: string;
}): React.ReactElement {
  return (
    <ul className="grid gap-2 sm:grid-cols-2 md:hidden">
      {items.map((p) => (
        <li
          key={p.id}
          className={`${CARTE} relative flex min-w-0 flex-col gap-2.5 p-3 transition-colors duration-[var(--motion-fast)] hover:border-[var(--border-strong)] motion-reduce:transition-none`}
        >
          <div className="flex min-w-0 items-start justify-between gap-2">
            <span className="flex min-w-0 items-center gap-2">
              <PastilleProjet couleur={p.color} />
              <Link
                href={hrefProjet(p.id)}
                className="min-w-0 truncate font-medium underline-offset-2 after:absolute after:inset-0 hover:underline"
              >
                {p.name}
              </Link>
            </span>
            <Statut p={p} />
          </div>
          <span className="truncate text-xs text-[var(--foreground-muted)]">
            {p.customerName ?? NATURES_PROJET[p.kind]}
          </span>
          <Avancement p={p} />
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <PileAvatars membres={p.members} total={p.memberCount} />
            <span className="flex items-center gap-3">
              <Retards n={p.overdueTaskCount} />
              <EcheanceProjet p={p} today={today} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Chiffres({ vue }: { vue: WorkPortfolioView | null }): React.ReactElement {
  if (vue === null) {
    return (
      <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <li key={i}>
            <Skeleton className="h-[68px] rounded-[var(--radius-lg)]" />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="grid grid-cols-3 gap-2 sm:gap-3" aria-label="Chiffres des projets">
      {cartesPortefeuille(vue).map((c) => (
        <li key={c.id} className={`${CARTE} flex min-w-0 flex-col gap-0.5 px-3 py-2.5 sm:px-3.5`}>
          <span className="truncate text-xs text-[var(--foreground-muted)]">{c.libelle}</span>
          <span
            className={`font-mono text-lg font-medium tabular-nums ${c.alerte ? 'text-[var(--danger)]' : ''}`}
          >
            {c.valeur}
          </span>
          <span className="truncate text-xs text-[var(--foreground-muted)] max-sm:hidden">
            {c.note}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ListeProjets(): React.ReactElement {
  const { actions } = useShell();
  const gerer = peutGerer(actions);
  const [scope, setScope] = useState<WorkPortfolioScope>('all');
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<WorkPortfolioView | null>(null);
  const [chiffres, setChiffres] = useState<WorkPortfolioView | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [creation, setCreation] = useState(false);

  const charger = useCallback(() => {
    setVue(null);
    workPortfolioApi
      .get(scope)
      .then((v) => {
        setVue(v);
        setChiffres(v);
        setErreur(null);
      })
      .catch((err: unknown) => setErreur(messageWork(err, 'Impossible de charger les projets.')));
  }, [scope]);

  useEffect(() => charger(), [charger]);

  const items = vue ? filtrerProjets(vue.items, recherche) : null;
  const vide = etatVide(scope, recherche, gerer);
  const boutonCreer = (
    <button
      type="button"
      className={buttonClasses('primary', 'md')}
      onClick={() => setCreation(true)}
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
      Nouveau projet
    </button>
  );

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <PageHeader
        module="run"
        moduleLabel="Exploiter"
        title="Projets"
        description="Tous les projets de l’équipe : où ils en sont, qui y travaille, ce qui est en retard."
        actions={
          <>
            <Link href={MES_TACHES_HREF} className={buttonClasses('secondary', 'md')}>
              Mes tâches
            </Link>
            {gerer ? boutonCreer : null}
          </>
        }
      />
      <Modal
        open={gerer && creation}
        onClose={() => setCreation(false)}
        title="Nouveau projet"
        size="lg"
      >
        {/* ADR-0062 / ADR-0063 : importer un fichier, construire avec l'IA. */}
        <ChoixCreation />
        <NouveauProjet onAnnule={() => setCreation(false)} />
      </Modal>

      <Chiffres vue={chiffres} />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="group"
          aria-label="Filtrer les projets"
          className="inline-flex w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-0.5 sm:w-auto"
        >
          {FILTRES_PORTEFEUILLE.map((f) => (
            <button
              key={f.cle}
              type="button"
              aria-pressed={scope === f.cle}
              onClick={() => setScope(f.cle)}
              className="h-8 flex-1 rounded-[calc(var(--radius-md)-2px)] px-3 text-[13px] font-medium text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:text-[var(--foreground)] aria-pressed:bg-[var(--accent-soft)] aria-pressed:text-[var(--accent)] motion-reduce:transition-none sm:flex-none"
            >
              {f.libelle}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <label htmlFor="pj-q" className="sr-only">
            Rechercher un projet
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--foreground-muted)]"
          />
          <input
            id="pj-q"
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            className={`${CHAMP} pl-8`}
            maxLength={100}
            placeholder="Projet ou client"
          />
        </div>
      </div>

      {erreur ? (
        <Alerte
          action={
            <button type="button" className={BOUTON_PETIT} onClick={charger}>
              Réessayer
            </button>
          }
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}

      {items === null ? (
        erreur ? null : (
          <div className="flex flex-col gap-2" aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[var(--row-h)] rounded-[var(--radius-md)]" />
            ))}
          </div>
        )
      ) : items.length === 0 ? (
        <EmptyState
          title={vide.titre}
          description={vide.texte}
          action={vide.creer ? boutonCreer : undefined}
        />
      ) : (
        <>
          <TableauProjets items={items} today={vue!.asOf} />
          <CartesProjets items={items} today={vue!.asOf} />
          {vue!.truncated ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Seuls les 500 projets les plus récemment modifiés sont affichés.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
