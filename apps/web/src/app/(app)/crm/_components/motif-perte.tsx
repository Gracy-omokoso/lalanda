'use client';

// Boîte du motif de perte — ADR-0040 § 6.2 et § 6.3 : passer une opportunité en
// « perdu » (glisser, clavier, menu) demande le motif, obligatoire si
// `lostReasonRequired`. Boîte modale native (`<dialog>`) : focus piégé et
// `Échap` qui annule, sans dépendance.

import { buttonClasses } from '@lalanda/ui';
import { useEffect, useRef, useState } from 'react';

import type { CrmSettingsView } from '@/lib/api-crm';

import { Alerte, CHAMP, Champ } from '../../ventes/_components/form-ui';

import { motifsActifs, preparerMotif } from './pipeline-model';

export interface DemandeMotif {
  titre: string;
  valider: (corps: { lostReasonKey: string | null; lostReasonDetail: string | null }) => void;
  annuler: () => void;
}

export function BoiteMotifPerte({
  demande,
  settings,
}: {
  demande: DemandeMotif | null;
  settings: Pick<CrmSettingsView, 'lostReasons' | 'lostReasonRequired'>;
}): React.ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const [key, setKey] = useState('');
  const [detail, setDetail] = useState('');
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (demande && !d.open) {
      setKey('');
      setDetail('');
      setErreur(null);
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!demande && d.open) {
      d.close();
    }
  }, [demande]);

  const motifs = motifsActifs(settings.lostReasons);

  return (
    <dialog
      ref={ref}
      aria-labelledby="motif-titre"
      onCancel={(e) => {
        e.preventDefault();
        demande?.annuler();
      }}
      className="w-[min(32rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-0 text-[var(--foreground)] shadow-[var(--shadow-pop)] backdrop:bg-black/40"
    >
      <form
        method="dialog"
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          const p = preparerMotif({ key, detail }, settings);
          if (!p.ok) {
            setErreur(p.erreur);
            return;
          }
          demande?.valider(p.corps);
        }}
      >
        <h2 id="motif-titre" className="font-display text-lg font-semibold">
          Pourquoi « {demande?.titre} » est-elle perdue ?
        </h2>
        <Champ
          id="motif-cle"
          label="Motif"
          requis={settings.lostReasonRequired}
          erreur={erreur ?? undefined}
        >
          <select
            id="motif-cle"
            className={CHAMP}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-invalid={erreur ? true : undefined}
          >
            <option value="">{settings.lostReasonRequired ? 'Choisir…' : 'Sans motif'}</option>
            {motifs.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </Champ>
        <Champ id="motif-detail" label="Détail (facultatif)">
          <textarea
            id="motif-detail"
            className={CHAMP}
            rows={3}
            maxLength={500}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        </Champ>
        {motifs.length === 0 && settings.lostReasonRequired ? (
          <Alerte>
            <p>Aucun motif actif : ajoutez-en dans les réglages du CRM.</p>
          </Alerte>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className={buttonClasses('secondary', 'md')}
            onClick={() => demande?.annuler()}
          >
            Annuler
          </button>
          <button type="submit" className={buttonClasses('primary', 'md')}>
            Passer en perdu
          </button>
        </div>
      </form>
    </dialog>
  );
}
