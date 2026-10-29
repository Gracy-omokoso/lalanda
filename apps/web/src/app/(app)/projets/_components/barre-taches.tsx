'use client';

// Briques partagées par la vue Liste et le Kanban : filtres, ajout rapide d'une
// tâche, case « terminer », et le hook `useFiltres`.

import type { WorkTaskView } from '@lalanda/shared/work';
import { useState } from 'react';

import { workApi } from '@/lib/work-api';

import { BOUTON_PETIT, CHAMP } from './elements';
import { useProjet } from './project-context';
import { PRIORITES } from './projets-model';
import { filtresActifs, filtresVides, type FiltresTaches } from './taches-model';

export function useFiltres(): [FiltresTaches, (f: FiltresTaches) => void] {
  const [f, setF] = useState<FiltresTaches>(filtresVides());
  return [f, setF];
}

export function BarreFiltres({
  filtres,
  onChange,
  idPrefixe,
}: {
  filtres: FiltresTaches;
  onChange: (f: FiltresTaches) => void;
  idPrefixe: string;
}): React.ReactElement {
  const { members, settings } = useProjet();
  const labels = settings?.labels ?? [];
  const id = (s: string) => `${idPrefixe}-${s}`;
  return (
    <div role="search" className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-1">
        <label htmlFor={id('q')} className="text-xs font-medium">
          Filtrer
        </label>
        <input
          id={id('q')}
          type="search"
          value={filtres.texte}
          onChange={(e) => onChange({ ...filtres, texte: e.target.value })}
          placeholder="Titre ou #numéro"
          className={CHAMP}
        />
      </div>
      <div className="flex basis-36 flex-col gap-1">
        <label htmlFor={id('resp')} className="text-xs font-medium">
          Responsable
        </label>
        <select
          id={id('resp')}
          value={filtres.responsable}
          onChange={(e) => onChange({ ...filtres, responsable: e.target.value })}
          className={CHAMP}
        >
          <option value="">Tous</option>
          <option value="aucun">Sans responsable</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      {labels.length > 0 ? (
        <div className="flex basis-32 flex-col gap-1">
          <label htmlFor={id('etiq')} className="text-xs font-medium">
            Étiquette
          </label>
          <select
            id={id('etiq')}
            value={filtres.etiquette}
            onChange={(e) => onChange({ ...filtres, etiquette: e.target.value })}
            className={CHAMP}
          >
            <option value="">Toutes</option>
            {labels.map((l) => (
              <option key={l.key} value={l.key}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="flex basis-28 flex-col gap-1">
        <label htmlFor={id('prio')} className="text-xs font-medium">
          Priorité
        </label>
        <select
          id={id('prio')}
          value={filtres.priorite}
          onChange={(e) =>
            onChange({ ...filtres, priorite: e.target.value as FiltresTaches['priorite'] })
          }
          className={CHAMP}
        >
          <option value="">Toutes</option>
          {(Object.keys(PRIORITES) as (keyof typeof PRIORITES)[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITES[p].label}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input
          type="checkbox"
          checked={filtres.masquerTerminees}
          onChange={(e) => onChange({ ...filtres, masquerTerminees: e.target.checked })}
        />
        Masquer les terminées
      </label>
      {filtresActifs(filtres) ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} mb-1`}
          onClick={() => onChange(filtresVides())}
        >
          Effacer les filtres
        </button>
      ) : null}
    </div>
  );
}

/** Ajout rapide : un titre, Entrée. Les autres champs se règlent dans le panneau. */
export function AjoutRapide({
  columnKey,
  idPrefixe,
  compact = false,
}: {
  columnKey?: string;
  idPrefixe: string;
  compact?: boolean;
}): React.ReactElement | null {
  const { projectId, travailler, appliquerEcriture, signalerErreur } = useProjet();
  const [titre, setTitre] = useState('');
  const [envoi, setEnvoi] = useState(false);
  if (!travailler) return null;

  async function ajouter(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const t = titre.trim();
    if (!t) return;
    setEnvoi(true);
    try {
      appliquerEcriture(
        await workApi.createTask(projectId, { title: t, ...(columnKey ? { columnKey } : {}) }),
      );
      setTitre('');
    } catch (err) {
      signalerErreur(err, 'Création de la tâche impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  const id = `${idPrefixe}-ajout`;
  return (
    <form onSubmit={(e) => void ajouter(e)} className="flex min-w-0 gap-2">
      <label htmlFor={id} className="sr-only">
        Nouvelle tâche
      </label>
      <input
        id={id}
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        placeholder={compact ? '+ Tâche' : 'Ajouter une tâche…'}
        maxLength={300}
        className={CHAMP}
      />
      <button type="submit" disabled={envoi || titre.trim() === ''} className={BOUTON_PETIT}>
        Ajouter
      </button>
    </form>
  );
}

/** Case « terminée » : terminer (colonne `done`) ou rouvrir (première `todo`). */
export function CaseTerminee({ task }: { task: WorkTaskView }): React.ReactElement {
  const { travailler, appliquerEcriture, signalerErreur } = useProjet();
  const [envoi, setEnvoi] = useState(false);
  async function basculer(): Promise<void> {
    setEnvoi(true);
    try {
      appliquerEcriture(
        task.done
          ? await workApi.reopenTask(task.id, task.revision)
          : await workApi.completeTask(task.id, task.revision),
      );
    } catch (err) {
      signalerErreur(err, 'Changement d’état impossible.');
    } finally {
      setEnvoi(false);
    }
  }
  return (
    <input
      type="checkbox"
      className="h-4 w-4 shrink-0"
      checked={task.done}
      disabled={!travailler || envoi}
      onChange={() => void basculer()}
      aria-label={
        task.done
          ? `Rouvrir #${task.number} ${task.title}`
          : `Terminer #${task.number} ${task.title}`
      }
    />
  );
}
