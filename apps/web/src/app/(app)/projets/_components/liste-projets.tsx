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
import {
  Button,
  DatePicker,
  EmptyState,
  EntityPicker,
  Field,
  Form,
  FormGrid,
  Modal,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatusPill,
  SubmitButton,
  TextArea,
  TextInput,
  buttonClasses,
  correspondRecherche,
} from '@lalanda/ui';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { api, type CustomerView } from '@/lib/api';
import { crmApi, type OpportunitySummary, type QuoteSummary } from '@/lib/api-crm';
import { workApi, type WorkMemberOption } from '@/lib/work-api';
import { workPortfolioApi } from '@/lib/work-portfolio-api';

import { useShell } from '../../_components/shell-context';
import { CustomerForm } from '../../ventes/_components/customer-form';

import { Alerte, BOUTON_PETIT } from './elements';
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

/** Client tel que le sélecteur le connaît. */
type ClientProjet = Pick<CustomerView, 'id' | 'name'> & Partial<Pick<CustomerView, 'nif'>>;

// Même lecture qu'avant (clients actifs), servie par la recherche de l'API.
const chercherClients = async (q: string): Promise<CustomerView[]> =>
  (await api.listCustomers({ status: 'active', limit: 50, ...(q ? { q } : {}) })).items;

function NouveauProjet({ onAnnule }: { onAnnule: () => void }): React.ReactElement {
  const router = useRouter();
  const { actions } = useShell();
  const [f, setF] = useState<FormulaireProjet>(formulaireProjet());
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [membres, setMembres] = useState<WorkMemberOption[]>([]);
  const [clientChoisi, setClientChoisi] = useState<ClientProjet | null>(null);
  const [opportunites, setOpportunites] = useState<OpportunitySummary[]>([]);
  const [devis, setDevis] = useState<QuoteSummary[]>([]);
  const ventes = actions?.includes('sales.read') ?? false;
  const crm = actions?.includes('crm.read') ?? false;
  // ADR-0074 § 4 : un client absent se crée sans quitter le projet (`sales.manage`, l'API juge).
  const creerClient = actions?.includes('sales.manage') ?? false;

  useEffect(() => {
    workApi
      .listMembers()
      .then((r) => setMembres(r.filter((m) => m.canUpdate)))
      .catch(() => setMembres([]));
    // Listes de liaison : seulement si le rôle les lit (sinon l'API répondrait 403).
    if (ventes) {
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

  const [visibilite, setVisibilite] = useState<'' | 'organization' | 'private'>('');

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
      // ADR-0060 : visibilité choisie ; sinon celle des réglages (ADR-0061).
      const projet = await workApi.createProject(
        visibilite === '' ? p.corps : { ...p.corps, visibility: visibilite },
      );
      router.push(hrefProjet(projet.id));
    } catch (err) {
      setErreur(messageWork(err, 'Création impossible.'));
      setEnvoi(false);
    }
  }

  const client = f.kind === 'client';
  const devisDuClient = f.customerId ? devis.filter((q) => q.customerId === f.customerId) : devis;
  const responsable = membres.find((m) => m.userId === f.ownerUserId) ?? null;

  return (
    <Form
      onSubmit={(e) => void creer(e)}
      aria-label="Nouveau projet"
      className="flex flex-col gap-4"
    >
      <FormGrid>
        <Field id="pj-nom" label="Nom du projet" required size="lg" error={champs['name']}>
          <TextInput
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            maxLength={120}
          />
        </Field>
        <Field id="pj-nature" label="Nature" group size="md">
          <SegmentedControl<FormulaireProjet['kind']>
            value={f.kind}
            onChange={(k) => setF({ ...f, kind: k })}
            options={(['client', 'internal'] as const).map((k) => ({
              value: k,
              label: NATURES_PROJET[k],
            }))}
          />
        </Field>
        {/* ADR-0060 : qui voit le projet (défaut : réglage « visibilité par défaut »). */}
        <Field id="pj-visibilite" label="Visibilité" size="md" newRow>
          <Select<'' | 'organization' | 'private'>
            value={visibilite}
            onChange={setVisibilite}
            options={[
              { value: '', label: 'Par défaut (réglages des Projets)' },
              { value: 'organization', label: 'Toute l’organisation' },
              { value: 'private', label: 'Membres seulement (privé)' },
            ]}
          />
        </Field>
        <Field
          id="pj-resp"
          label="Responsable du projet"
          size="md"
          hint="Tapez pour chercher. Vide : aucun pour l’instant."
          error={champs['ownerUserId']}
        >
          <EntityPicker<WorkMemberOption>
            value={responsable}
            onChange={(m) => setF({ ...f, ownerUserId: m?.userId ?? '' })}
            search={async (q) => membres.filter((m) => correspondRecherche([m.name], q))}
            refreshKey={membres.length}
            getKey={(m) => m.userId}
            getLabel={(m) => m.name}
            placeholder="Aucun pour l’instant"
            debounceMs={0}
            emptyText="Aucun membre ne correspond."
          />
        </Field>
        <Field id="pj-debut" label="Début" size="sm" newRow error={champs['startDate']}>
          <DatePicker
            value={f.startDate}
            onChange={(v) => setF({ ...f, startDate: v })}
            shortcuts={['today']}
          />
        </Field>
        <Field id="pj-fin" label="Échéance" size="sm" error={champs['dueDate']}>
          <DatePicker
            value={f.dueDate}
            onChange={(v) => setF({ ...f, dueDate: v })}
            shortcuts={['endOfMonth', 'plus30', 'endOfYear']}
          />
        </Field>
        {client && ventes ? (
          <>
            <Field
              id="pj-client"
              label="Client"
              size="lg"
              newRow
              hint={
                creerClient
                  ? 'Tapez un nom, un NIF ou un e-mail. Client absent : « + » le crée sans quitter le projet.'
                  : 'Tapez un nom, un NIF ou un e-mail.'
              }
              error={champs['customerId']}
            >
              <EntityPicker<ClientProjet>
                value={clientChoisi}
                onChange={(c) => {
                  setClientChoisi(c);
                  setF({ ...f, customerId: c?.id ?? '', quoteId: '' });
                }}
                search={chercherClients}
                getKey={(c) => c.id}
                getLabel={(c) => c.name}
                getDescription={(c) => (c.nif ? `NIF ${c.nif}` : null)}
                placeholder="Aucun"
                recentKey="ventes.clients"
                createTitle="Nouveau client"
                createButtonLabel="Créer un client"
                createSize="lg"
                {...(creerClient
                  ? {
                      createForm: ({ initialText, onCreated, onCancel }) => (
                        <CustomerForm
                          fiche={{ mode: 'creation' }}
                          gerer
                          base="/ventes/clients"
                          enModal
                          nomInitial={initialText}
                          onFermer={(c) => (c ? onCreated(c) : onCancel())}
                        />
                      ),
                    }
                  : {})}
              />
            </Field>
            <Field
              id="pj-devis"
              label="Devis accepté"
              size="lg"
              newRow
              hint="Le devis reste la référence des montants : aucun montant n’est recopié dans le projet."
              error={champs['quoteId']}
            >
              <Select<string>
                value={f.quoteId}
                onChange={(v) => setF({ ...f, quoteId: v })}
                options={[
                  { value: '', label: 'Aucun' },
                  ...devisDuClient.map((q) => ({
                    value: q.id,
                    label: `${q.number}${q.title ? ` — ${q.title}` : ''}`,
                    description: q.customerName ?? undefined,
                    keywords: q.customerName ?? undefined,
                  })),
                ]}
              />
            </Field>
          </>
        ) : null}
        {client && crm ? (
          <Field id="pj-opp" label="Opportunité" size="lg" newRow error={champs['opportunityId']}>
            <Select<string>
              value={f.opportunityId}
              onChange={(v) => setF({ ...f, opportunityId: v })}
              options={[
                { value: '', label: 'Aucune' },
                ...opportunites.map((o) => ({ value: o.id, label: o.title })),
              ]}
            />
          </Field>
        ) : null}
        <Field id="pj-desc" label="Description" optional size="full" error={champs['description']}>
          <TextArea
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            rows={3}
            maxLength={5000}
          />
        </Field>
      </FormGrid>
      <p className="text-xs text-[var(--foreground-muted)]">
        Les colonnes du Kanban sont celles proposées par défaut ; vous pourrez les renommer, en
        ajouter ou les réordonner dans les Réglages du projet.
      </p>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
        <SubmitButton busy={envoi} busyLabel="Création…" className="max-sm:h-11">
          Créer le projet
        </SubmitButton>
        <Button onClick={onAnnule} className="max-sm:h-11">
          Annuler
        </Button>
      </div>
    </Form>
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
        <SegmentedControl<WorkPortfolioScope>
          aria-label="Filtrer les projets"
          value={scope}
          onChange={setScope}
          options={FILTRES_PORTEFEUILLE.map((f) => ({ value: f.cle, label: f.libelle }))}
        />
        <TextInput
          id="pj-q"
          type="search"
          aria-label="Rechercher un projet"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          maxLength={100}
          placeholder="Projet ou client"
          leading={<Search aria-hidden="true" className="h-4 w-4" />}
          className="sm:w-64"
        />
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
