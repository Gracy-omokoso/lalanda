'use client';

// Champs du motif d'un geste de la console (ADR-0053 — P2) : catégorie, message destiné
// au client (il paraît dans SON journal, sous « Équipe Lalanda »), note interne (jamais
// montrée au client).

import { CATEGORIES_MOTIF, NOTE_INTERNE_MIN, type MotifSaisi } from './motif-model';

const CHAMP =
  'w-full max-w-xl rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const ETIQUETTE =
  'font-mono text-[0.66rem] uppercase tracking-[0.1em] text-[var(--foreground-muted)]';

export function ChampsMotif({
  motif,
  onChange,
  avecCategorie,
  avecMessageClient,
  libelleMessageClient = 'Message destiné au client',
}: {
  motif: MotifSaisi;
  onChange: (m: MotifSaisi) => void;
  avecCategorie: boolean;
  avecMessageClient: boolean;
  libelleMessageClient?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {avecCategorie ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>Catégorie de motif</span>
          <select
            value={motif.reasonCategory}
            onChange={(e) =>
              onChange({ ...motif, reasonCategory: e.target.value as MotifSaisi['reasonCategory'] })
            }
            className="w-56 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
          >
            <option value="">Choisir…</option>
            {CATEGORIES_MOTIF.map((c) => (
              <option key={c.valeur} value={c.valeur}>
                {c.libelle}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {avecMessageClient ? (
        <label className="flex flex-col gap-1 text-sm">
          <span className={ETIQUETTE}>{libelleMessageClient}</span>
          <textarea
            value={motif.clientMessage}
            onChange={(e) => onChange({ ...motif, clientMessage: e.target.value })}
            rows={2}
            maxLength={500}
            className={CHAMP}
          />
        </label>
      ) : null}
      <label className="flex flex-col gap-1 text-sm">
        <span className={ETIQUETTE}>Note interne ({NOTE_INTERNE_MIN} caractères minimum)</span>
        <textarea
          value={motif.internalNote}
          onChange={(e) => onChange({ ...motif, internalNote: e.target.value })}
          rows={2}
          maxLength={1000}
          className={CHAMP}
        />
      </label>
    </div>
  );
}
