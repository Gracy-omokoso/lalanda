'use client';

// Encadré « Créer le projet » d'un devis accepté (ADR-0039 § 6.1, lot L4a).
//
// Proposer, jamais imposer : aucun projet n'est créé à l'acceptation. L'encadré
// paraît sur un devis `accepted` quand l'appelant détient `work.manage` (créer)
// ou `work.read` (ouvrir le projet existant). Le projet reprend une tâche par
// ligne du devis, SANS montant : le devis fait foi.

import { buttonClasses } from '@lalanda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { OrgAction } from '@/lib/api';
import { workBillingApi, workErrorCode, workErrorDetails } from '@/lib/work-billing-api';

/** Chemin de la page d'un projet du RUN (ADR-0039 § 8). */
const projetHref = (projectId: string) => `/projets/${encodeURIComponent(projectId)}`;

export function QuoteProjectBox({
  quoteId,
  status,
  actions,
}: {
  quoteId: string;
  status: string;
  actions: readonly OrgAction[] | null;
}): React.ReactElement | null {
  const router = useRouter();
  const lire = actions?.includes('work.read') ?? false;
  const gerer = actions?.includes('work.manage') ?? false;
  const visible = status === 'accepted' && lire;
  const [projectId, setProjectId] = useState<string | null | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let actif = true;
    workBillingApi
      .projectForQuote(quoteId)
      .then((r) => {
        if (actif) setProjectId(r.projectId);
      })
      .catch(() => {
        if (actif) setProjectId(null);
      });
    return () => {
      actif = false;
    };
  }, [quoteId, visible]);

  if (!visible || projectId === undefined) return null;
  if (projectId === null && !gerer) return null;

  async function creer(): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    try {
      const p = await workBillingApi.createFromQuote({ quoteId });
      router.push(projetHref(p.id));
    } catch (err) {
      const existant = workErrorDetails(err)['projectId'];
      if (workErrorCode(err) === 'WORK_PROJECT_EXISTS_FOR_QUOTE' && typeof existant === 'string') {
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
      aria-label="Projet du devis"
      className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      {projectId ? (
        <>
          <p>Un projet suit l’exécution de ce devis.</p>
          <Link href={projetHref(projectId)} className={buttonClasses('secondary', 'sm')}>
            Ouvrir le projet
          </Link>
        </>
      ) : (
        <>
          <p>
            Suivre l’exécution : créer un projet client avec une tâche par ligne du devis (sans
            montant, le devis fait foi).
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
      )}
      {erreur ? (
        <p role="alert" className="text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
    </section>
  );
}
