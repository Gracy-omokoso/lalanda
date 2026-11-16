'use client';

// Encadré « Projet » d'un contrat signé — ADR-0077 § 1.7 (motif de `QuoteProjectBox`).
//
// Proposer, jamais imposer : signer ne crée aucun projet. L'encadré paraît sur un contrat
// `signed` avec `work.read` (ouvrir) ; « Créer le projet » exige `work.manage`. Le serveur
// relie le projet du devis ou de l'opportunité s'il existe, sinon crée une tâche par ligne
// SANS montant (le contrat fait foi) et, sur option, un jalon par échéance.

import { Checkbox, buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { workErrorCode, workErrorDetails } from '@/lib/work-billing-api';
import { workSyncApi } from '@/lib/work-sync-api';

const projetHref = (projectId: string) => `/projets/${encodeURIComponent(projectId)}`;

export function ContractProjectBox({
  contractId,
  status,
  projectId: initial,
  echeancier,
  actions,
}: {
  contractId: string;
  status: string;
  projectId: string | null;
  /** Le contrat facture par échéancier : proposer un jalon par échéance. */
  echeancier: boolean;
  actions: readonly OrgAction[] | null;
}): React.ReactElement | null {
  const router = useRouter();
  const lire = actions?.includes('work.read') ?? false;
  const gerer = actions?.includes('work.manage') ?? false;
  const [projectId, setProjectId] = useState(initial);
  const [jalons, setJalons] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  if (!lire || status !== 'signed') return null;
  if (projectId === null && !gerer) return null;

  async function creer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await workSyncApi.createFromContract({
        contractId,
        ...(echeancier ? { scheduleMilestones: jalons } : {}),
      });
      router.push(projetHref(r.project.id));
    } catch (err) {
      const existant = workErrorDetails(err)['projectId'];
      if (
        workErrorCode(err) === 'WORK_PROJECT_EXISTS_FOR_CONTRACT' &&
        typeof existant === 'string'
      ) {
        setProjectId(existant);
      } else {
        setErreur(err instanceof Error ? err.message : 'Le projet n’a pas pu être créé.');
      }
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section
      aria-label="Projet du contrat"
      className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3 text-sm"
    >
      {projectId ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>Un projet suit l’exécution de ce contrat.</p>
          <Link href={projetHref(projectId)} className={buttonClasses('secondary', 'sm')}>
            Ouvrir le projet
          </Link>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Suivre l’exécution : relier le projet du devis s’il existe, sinon créer un projet
              client avec une tâche par ligne du contrat (sans montant, le contrat fait foi).
            </p>
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              disabled={envoi}
              onClick={() => void creer()}
            >
              {envoi ? 'Création…' : 'Créer le projet'}
            </button>
          </div>
          {echeancier ? (
            <Checkbox
              checked={jalons}
              onChange={setJalons}
              label="Un jalon par échéance"
              description="Chaque échéance de l’échéancier devient un jalon daté ; sa facture se prépare depuis le contrat."
            />
          ) : null}
        </>
      )}
      {erreur ? (
        <p role="alert" className="text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
