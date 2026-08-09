'use client';

// Tableau de bord de la plateforme (S21b).
//
// Des COMPTEURS, pas des données clientes. Aucun nom d'organisation, aucune
// adresse, aucun montant ne figure ici : l'exploitation de la plateforme se
// pilote sur des volumes, et un tableau de bord qui afficherait « les cinq plus
// gros clients » ferait de la page d'accueil de l'espace un accès permanent aux
// données de tiers — précisément ce qu'ADR-0012 §4 refuse.
//
// Le bloc le plus important est le dernier : les trois actes interdits à TOUS
// les rôles plateforme. Ils sont affichés, pas seulement absents. Une absence
// s'interprète comme un oubli; une interdiction écrite ne s'interprète pas.

import { useEffect, useState } from 'react';

import { api, type PlatformOverview } from '@/lib/api';

import { useAccesPlateforme } from './admin-access';
import { Bandeau, Compteur } from './admin-chrome';
import { LIBELLES_PLAN, messageErreur } from './admin-model';

export function OverviewPanel(): React.ReactElement {
  const acces = useAccesPlateforme();
  const [vue, setVue] = useState<PlatformOverview | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    void api
      .getAdminOverview()
      .then((v) => {
        if (!annule) setVue(v);
      })
      .catch((err: unknown) => {
        if (!annule) setErreur(messageErreur(err, 'Impossible de charger le tableau de bord.'));
      })
      .finally(() => {
        if (!annule) setChargement(false);
      });
    return () => {
      annule = true;
    };
  }, []);

  if (chargement) {
    return <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>;
  }
  if (erreur) {
    return <Bandeau ton="echec">{erreur}</Bandeau>;
  }
  if (!vue) return <Bandeau ton="echec">Tableau de bord indisponible.</Bandeau>;

  const ia = vue.aiCalls.last30Days;

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">Volumes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Compteur
            libelle="Organisations"
            valeur={vue.organizations.total}
            precision={
              vue.organizations.suspended > 0
                ? `dont ${vue.organizations.suspended} suspendue${vue.organizations.suspended > 1 ? 's' : ''}`
                : 'aucune suspendue'
            }
          />
          <Compteur
            libelle="Comptes"
            valeur={vue.users.total}
            precision={`dont ${vue.users.withPlatformRole} avec un rôle plateforme`}
          />
          <Compteur libelle="Projets" valeur={vue.projects.total} />
          <Compteur
            libelle="Plans validés"
            valeur={vue.approvedPlans.total}
            precision="cumul depuis l’origine"
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">Répartition par plan</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(LIBELLES_PLAN) as Array<keyof typeof LIBELLES_PLAN>).map((plan) => (
            <Compteur key={plan} libelle={LIBELLES_PLAN[plan]} valeur={vue.plans[plan] ?? 0} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">
          Appels IA — 30 derniers jours
        </h2>
        <p className="max-w-2xl text-sm text-[var(--foreground-muted)]">
          Le repli déterministe est compté à part, et c’est le chiffre à regarder : il monte quand
          la clé OpenAI est absente, expirée ou rejetée. L’application continue de fonctionner —
          l’IA explique, elle ne calcule pas — mais les explications deviennent génériques sans que
          personne ne s’en plaigne.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Compteur libelle="Total" valeur={ia.total} />
          <Compteur libelle="Servis par le modèle" valeur={ia.llm} />
          <Compteur
            libelle="Repli déterministe"
            valeur={ia.fallback}
            precision={
              ia.total > 0 ? `${Math.round((ia.fallback / ia.total) * 100)} % des appels` : '—'
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">Limites de votre accès</h2>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p className="text-sm text-[var(--foreground-muted)]">
            Vos rôles plateforme :{' '}
            <span className="text-[var(--foreground)]">
              {acces.roles.map((r) => r.label).join(', ') || 'aucun'}
            </span>
            .
          </p>
          <p className="mt-3 text-sm text-[var(--foreground-muted)]">
            Ces actes restent refusés à <strong className="text-[var(--foreground)]">tous</strong>{' '}
            les rôles plateforme, y compris super-administrateur. Aucune escalade ne les ouvre :
            valider un plan, clôturer une période ou exporter un rapport engage l’organisation
            cliente, et un opérateur de la plateforme ne peut pas l’engager à sa place.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {acces.forbiddenActions.map((action) => (
              <li
                key={action}
                className="font-mono rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-0.5 text-[0.68rem] text-[var(--foreground-muted)]"
              >
                {action}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
