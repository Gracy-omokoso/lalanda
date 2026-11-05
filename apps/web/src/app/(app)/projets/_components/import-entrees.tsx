'use client';

// Points d'entrée de l'import (ADR-0062) et de la construction par l'IA
// (ADR-0063) : en tête du formulaire « Nouveau projet », et dans la barre de la
// Liste d'un projet (« Importer des tâches », `work.update`).

import { FileSpreadsheet, Sparkles, Upload } from 'lucide-react';
import Link from 'next/link';

import { BOUTON_PETIT } from './elements';
import { IA_HREF, IMPORT_HREF, hrefImportProjet } from './import-model';

const CHOIX =
  'flex min-w-0 flex-1 items-start gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors duration-[var(--motion-fast)] hover:border-[var(--accent)] hover:bg-[var(--surface-muted)] motion-reduce:transition-none';

/** Deux raccourcis au-dessus du formulaire « Nouveau projet ». */
export function ChoixCreation(): React.ReactElement {
  return (
    <div className="mb-4 flex flex-col gap-2 border-b border-[var(--border)] pb-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href={IMPORT_HREF} className={CHOIX}>
          <FileSpreadsheet
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]"
          />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Importer un fichier</span>
            <span className="text-xs text-[var(--foreground-muted)]">
              Excel ou CSV, avec un modèle à télécharger et un aperçu des erreurs.
            </span>
          </span>
        </Link>
        <Link href={IA_HREF} className={CHOIX}>
          <Sparkles aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--accent)]" />
          <span className="flex flex-col">
            <span className="text-sm font-medium">Construire avec l’IA</span>
            <span className="text-xs text-[var(--foreground-muted)]">
              Jalons, sprints et tâches proposés ; vous relisez avant de créer.
            </span>
          </span>
        </Link>
      </div>
      <p className="text-xs text-[var(--foreground-muted)]">Ou saisissez le projet ci-dessous.</p>
    </div>
  );
}

/** « Importer des tâches » dans un projet existant. */
export function BoutonImporterTaches({ projectId }: { projectId: string }): React.ReactElement {
  return (
    <Link
      href={hrefImportProjet(projectId)}
      className={`${BOUTON_PETIT} inline-flex items-center gap-1.5`}
    >
      <Upload aria-hidden="true" className="h-3.5 w-3.5" />
      Importer des tâches
    </Link>
  );
}
