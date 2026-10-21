'use client';

// Export du journal électronique pour les vérificateurs DGI (ADR-0026 § 6.3,
// exigence 1.20) : factures émises et normalisées d'une période, avec leurs
// lignes, totaux par groupe, éléments DGI et l'état de vérification de la
// chaîne ; échanges avec l'e-MCF. Réservé à `fiscal.manage` (comme l'onglet).

import { useState } from 'react';

import { api } from '@/lib/api';

import {
  type ChoixExport,
  LIBELLES_EXPORT,
  erreurPeriode,
  nomFichierExport,
  periodeParDefaut,
  requeteExport,
} from './journal-export-model';
import { messageFiscal } from './fiscal-model';

const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-4 py-2 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';
const CHAMP =
  'rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]';

function telecharger(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function JournalExportPanel(): React.ReactElement {
  const [periode, setPeriode] = useState(() => periodeParDefaut(new Date()));
  const [choix, setChoix] = useState<ChoixExport>('json');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const erreurDates = erreurPeriode(periode.from, periode.to);

  async function exporter(): Promise<void> {
    if (erreurDates) return;
    setEnvoi(true);
    setErreur(null);
    setNotice(null);
    const q = requeteExport(choix, periode.from, periode.to);
    try {
      const f = await api.downloadSalesJournalExport(q, nomFichierExport(q));
      telecharger(f.blob, f.filename);
      setNotice(`Fichier ${f.filename} téléchargé.`);
    } catch (err) {
      setErreur(messageFiscal(err, 'L’export du journal a échoué.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <section aria-labelledby="export-journal-titre" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="export-journal-titre" className="font-display text-lg font-bold tracking-tight">
          Journal électronique — export pour les vérificateurs
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Factures émises et normalisées de la période (lignes, totaux par groupe, Code DEF/DGI,
          NIM, compteurs), journal chaîné avec son état de vérification, et échanges avec l’e-MCF.
          Les documents figés sont lus tels quels ; chaque export est tracé.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          void exporter();
        }}
        noValidate
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="export-du" className="text-sm">
            Du
          </label>
          <input
            id="export-du"
            type="date"
            value={periode.from}
            onChange={(e) => setPeriode((p) => ({ ...p, from: e.target.value }))}
            className={CHAMP}
            aria-describedby={erreurDates ? 'export-erreur-dates' : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="export-au" className="text-sm">
            Au (inclus)
          </label>
          <input
            id="export-au"
            type="date"
            value={periode.to}
            onChange={(e) => setPeriode((p) => ({ ...p, to: e.target.value }))}
            className={CHAMP}
            aria-describedby={erreurDates ? 'export-erreur-dates' : undefined}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="export-format" className="text-sm">
            Contenu
          </label>
          <select
            id="export-format"
            value={choix}
            onChange={(e) => setChoix(e.target.value as ChoixExport)}
            className={CHAMP}
          >
            {(Object.keys(LIBELLES_EXPORT) as ChoixExport[]).map((c) => (
              <option key={c} value={c}>
                {LIBELLES_EXPORT[c]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={BOUTON} disabled={envoi || erreurDates !== null}>
          {envoi ? 'Export en cours…' : 'Exporter le journal'}
        </button>
      </form>
      {erreurDates ? (
        <p id="export-erreur-dates" className="text-xs font-medium text-[var(--danger)]">
          {erreurDates}
        </p>
      ) : null}
      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-[var(--foreground-muted)]">
        {notice ?? ''}
      </p>
      {erreur ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {erreur}
        </p>
      ) : null}
      <p className="text-xs text-[var(--foreground-muted)]">
        Dates à l’heure de Kinshasa ; 366 jours au plus. Les montants sont ceux qui font foi (CDF
        pour une facture normalisée), au format décimal à point.
      </p>
    </section>
  );
}
