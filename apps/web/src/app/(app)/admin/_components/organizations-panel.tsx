'use client';

// Organisations clientes (S21b) — liste, détail, changement de plan, suspension.
//
// ── Le détail est un DÉPLIÉ, pas une page ────────────────────────────────────
//
// Ouvrir le détail ne charge rien de plus : `GET /admin/organizations` sert déjà
// tout ce qui est affiché. C'est délibéré. Une page de détail invite à y ajouter
// « pendant qu'on y est » les projets, puis les membres, puis les plans — et
// l'espace d'administration devient une fenêtre permanente sur les données des
// clients. Les compteurs suffisent à exploiter; le contenu appartient au client.
//
// ── Les écritures sont réservées et le disent ────────────────────────────────
//
// `canManagePlatform` masque les commandes; `PermissionsGuard` les refuse. Quand
// le drapeau est faux, on affiche la RAISON à côté de la ligne plutôt que rien :
// une commande absente n'explique pas son absence.

import { useCallback, useEffect, useState } from 'react';

import { api, type AdminOrganizationSummary, type Plan } from '@/lib/api';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Pastille, Vide } from './admin-chrome';
import {
  formaterDate,
  LIBELLES_PLAN,
  messageErreur,
  MOTIF_SUSPENSION_MIN,
  motifSuspensionValide,
} from './admin-model';

const PLANS = Object.keys(LIBELLES_PLAN) as Plan[];

export function OrganizationsPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const [recherche, setRecherche] = useState('');
  const [organisations, setOrganisations] = useState<AdminOrganizationSummary[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [ouverte, setOuverte] = useState<string | null>(null);

  const charger = useCallback(async (q: string): Promise<void> => {
    setChargement(true);
    try {
      const { organizations } = await api.listAdminOrganizations(q.trim() || undefined);
      setOrganisations(organizations);
      setErreur(null);
    } catch (err) {
      setErreur(messageErreur(err, 'Impossible de charger les organisations.'));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger('');
  }, [charger]);

  /** Remplace une ligne sur place — recharger perdrait le dépli et la recherche. */
  const remplacer = useCallback((maj: AdminOrganizationSummary): void => {
    setOrganisations((liste) => (liste ? liste.map((o) => (o.id === maj.id ? maj : o)) : liste));
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void charger(recherche);
        }}
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
            Rechercher
          </span>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Nom ou identifiant d’URL"
            className="w-72 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)]"
        >
          Chercher
        </button>
      </form>

      {erreur ? <Bandeau ton="echec">{erreur}</Bandeau> : null}

      {chargement ? (
        <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
      ) : !organisations || organisations.length === 0 ? (
        <Vide>
          {recherche.trim()
            ? 'Aucune organisation ne correspond à cette recherche.'
            : 'Aucune organisation.'}
        </Vide>
      ) : (
        <ul className="flex flex-col gap-2">
          {organisations.map((org) => (
            <LigneOrganisation
              key={org.id}
              org={org}
              ouverte={ouverte === org.id}
              onBasculer={() => setOuverte((id) => (id === org.id ? null : org.id))}
              peutEcrire={acces.canManagePlatform}
              onMaj={remplacer}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneOrganisation({
  org,
  ouverte,
  onBasculer,
  peutEcrire,
  onMaj,
}: {
  org: AdminOrganizationSummary;
  ouverte: boolean;
  onBasculer: () => void;
  peutEcrire: boolean;
  onMaj: (maj: AdminOrganizationSummary) => void;
}): React.ReactElement {
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex flex-col">
          <span className="font-medium">{org.name}</span>
          <span className="font-mono text-xs text-[var(--foreground-muted)]">
            {org.slug} · {org.pays} · créée le {formaterDate(org.createdAt)}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <Pastille ton="neutre">{LIBELLES_PLAN[org.plan] ?? org.plan}</Pastille>
          {org.suspended ? <Pastille ton="echec">Suspendue</Pastille> : null}
          <span className="font-mono text-xs text-[var(--foreground-muted)]">
            {org.memberCount} membre{org.memberCount > 1 ? 's' : ''} · {org.projectCount} projet
            {org.projectCount > 1 ? 's' : ''}
          </span>
        </span>
      </button>

      {ouverte ? (
        <div className="flex flex-col gap-5 border-t border-[var(--border)] px-4 py-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fiche libelle="Identifiant" valeur={org.id} mono />
            <Fiche libelle="Type" valeur={org.type} />
            <Fiche libelle="Propriétaire" valeur={org.ownerId} mono />
            <Fiche libelle="Créée le" valeur={formaterDate(org.createdAt)} />
          </dl>

          {org.suspended && org.suspendedReason ? (
            <Bandeau ton="attention">
              <strong>Suspendue.</strong> Motif enregistré : {org.suspendedReason}
            </Bandeau>
          ) : null}

          {peutEcrire ? (
            <>
              <ChangementPlan org={org} onMaj={onMaj} />
              <Suspension org={org} onMaj={onMaj} />
            </>
          ) : (
            <Bandeau ton="neutre">
              Votre rôle plateforme ouvre la consultation, pas la gestion. Le changement de plan et
              la suspension demandent le rôle Administrateur ou Super-administrateur de plateforme.
            </Bandeau>
          )}
        </div>
      ) : null}
    </li>
  );
}

function Fiche({
  libelle,
  valeur,
  mono,
}: {
  libelle: string;
  valeur: string;
  mono?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]">
        {libelle}
      </dt>
      <dd className={mono ? 'font-mono text-xs break-all' : ''}>{valeur}</dd>
    </div>
  );
}

function ChangementPlan({
  org,
  onMaj,
}: {
  org: AdminOrganizationSummary;
  onMaj: (maj: AdminOrganizationSummary) => void;
}): React.ReactElement {
  const [plan, setPlan] = useState<Plan>(org.plan);
  const [etat, setEtat] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function soumettre(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setEtat(null);
    try {
      onMaj(await api.setOrganizationPlan(org.id, plan));
      setEtat({ ton: 'succes', texte: 'Plan modifié. Le changement figure au journal.' });
    } catch (err) {
      setEtat({ ton: 'echec', texte: messageErreur(err, 'Le plan n’a pas pu être modifié.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void soumettre(e)}>
      <h3 className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
        Plan
      </h3>
      <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">
        Le changement est immédiat et sans facturation : il n’y a pas de paiement branché. Un
        rétrogradage ne supprime rien — les projets au-delà de la limite du nouveau plan restent
        lisibles, seule la création est bloquée.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={plan}
          onChange={(e) => setPlan(e.target.value as Plan)}
          aria-label={`Plan de ${org.name}`}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
        >
          {PLANS.map((p) => (
            <option key={p} value={p}>
              {LIBELLES_PLAN[p]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={envoi || plan === org.plan}
          className="rounded-md border border-[var(--border)] px-3 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-40"
        >
          {envoi ? 'Enregistrement…' : 'Changer le plan'}
        </button>
      </div>
      {etat ? <Bandeau ton={etat.ton}>{etat.texte}</Bandeau> : null}
    </form>
  );
}

function Suspension({
  org,
  onMaj,
}: {
  org: AdminOrganizationSummary;
  onMaj: (maj: AdminOrganizationSummary) => void;
}): React.ReactElement {
  const [motif, setMotif] = useState('');
  const [etat, setEtat] = useState<{ ton: 'succes' | 'echec'; texte: string } | null>(null);
  const [envoi, setEnvoi] = useState(false);

  async function agir(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setEnvoi(true);
    setEtat(null);
    try {
      if (org.suspended) {
        onMaj(await api.liftOrganizationSuspension(org.id));
        setEtat({ ton: 'succes', texte: 'Suspension levée.' });
      } else {
        onMaj(await api.suspendOrganization(org.id, motif.trim()));
        setMotif('');
        setEtat({ ton: 'succes', texte: 'Organisation suspendue. Le motif figure au journal.' });
      }
    } catch (err) {
      setEtat({ ton: 'echec', texte: messageErreur(err, 'L’action a échoué.') });
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => void agir(e)}>
      <h3 className="font-mono text-[0.68rem] uppercase tracking-[0.08em] text-[var(--foreground-muted)]">
        Suspension
      </h3>
      <p className="max-w-2xl text-xs text-[var(--foreground-muted)]">
        Une suspension ferme l’accès à l’organisation pour tous ses membres. Elle ne supprime aucune
        donnée et se lève sans perte. Le motif est obligatoire et part au journal : c’est lui qu’on
        relira dans six mois pour comprendre la décision.
      </p>
      {org.suspended ? null : (
        <label className="flex flex-col gap-1 text-sm">
          <span className="sr-only">Motif de suspension de {org.name}</span>
          <textarea
            value={motif}
            onChange={(e) => setMotif(e.target.value)}
            rows={2}
            placeholder={`Motif (${MOTIF_SUSPENSION_MIN} caractères minimum)`}
            className="w-full max-w-xl rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          />
        </label>
      )}
      <div>
        <button
          type="submit"
          disabled={envoi || (!org.suspended && !motifSuspensionValide(motif))}
          className="rounded-md border border-[var(--danger)]/40 px-3 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-40"
        >
          {envoi ? 'En cours…' : org.suspended ? 'Lever la suspension' : 'Suspendre l’organisation'}
        </button>
      </div>
      {etat ? <Bandeau ton={etat.ton}>{etat.texte}</Bandeau> : null}
    </form>
  );
}
