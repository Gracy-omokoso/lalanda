'use client';

// Encadré « Créer le projet » d'une opportunité gagnée — ADR-0040 — C7 § 6.4.
//
// Proposer, jamais imposer : passer en « gagnée » ne crée aucun projet. Le
// projet reprend une tâche par ligne (de l'opportunité, ou de son devis accepté),
// SANS montant. Décisions d'affichage : `creer-projet-model.ts` (testé).

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { workBillingApi, workErrorCode, workErrorDetails } from '@/lib/work-billing-api';

import { etatCreerProjet, lienProjet, peutLireProjet, suiteRefus } from './creer-projet-model';

export function CreerProjet({
  opportunityId,
  status,
  actions,
}: {
  opportunityId: string;
  status: string;
  actions: readonly OrgAction[] | null;
}): React.ReactElement | null {
  const router = useRouter();
  const lire = status === 'won' && peutLireProjet(actions);
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!lire) return;
    let actif = true;
    workBillingApi
      .projectForOpportunity(opportunityId)
      .then((r) => {
        if (actif) setProjectId(r.projectId);
      })
      .catch(() => {
        if (actif) setProjectId(null);
      });
    return () => {
      actif = false;
    };
  }, [opportunityId, lire]);

  const etat = etatCreerProjet({ status, actions, projectId });
  if (etat.genre === 'cache' || etat.genre === 'chargement') return null;

  async function creer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const p = await workBillingApi.createFromOpportunity({ opportunityId });
      router.push(lienProjet(p.id));
    } catch (err) {
      const suite = suiteRefus(workErrorCode(err), workErrorDetails(err));
      if ('projectId' in suite) setProjectId(suite.projectId);
      else setErreur(suite.message);
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section
      aria-label="Projet de l’opportunité"
      className="flex flex-col gap-2 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--ok)_10%,var(--surface))] p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      {etat.genre === 'ouvrir' ? (
        <>
          <p>Un projet suit l’exécution de cette opportunité gagnée.</p>
          <Link href={lienProjet(etat.projectId)} className={buttonClasses('secondary', 'sm')}>
            Ouvrir le projet
          </Link>
        </>
      ) : etat.genre === 'creer' ? (
        <>
          <p>
            <strong>Opportunité gagnée.</strong> Suivre l’exécution : créer un projet client avec
            une tâche par ligne (sans montant ; le devis accepté fait foi s’il existe).
          </p>
          <button
            type="button"
            className={buttonClasses('primary', 'sm')}
            disabled={envoi}
            onClick={() => void creer()}
          >
            {envoi ? 'Création…' : 'Créer le projet'}
          </button>
        </>
      ) : (
        <p>
          <strong>Opportunité gagnée.</strong> Un responsable des projets peut créer le projet.
        </p>
      )}
      {erreur ? (
        <p role="alert" className="text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
