'use client';

// Briques partagées par la vue Liste et le Kanban : filtres, ajout rapide d'une
// tâche, case « terminer », et le hook `useFiltres`. ADR-0074 : filtres sur
// `Field` + `Select`, « Masquer les terminées » en interrupteur ; les champs
// d'ajout en ligne restent compacts (une ligne, Entrée).

import type { WorkTaskView } from '@lalanda/shared/work';
import { Button, Field, FormGrid, Select, Switch, TextInput } from '@lalanda/ui';
import { Search } from 'lucide-react';
import { useRef, useState } from 'react';

import { workApi } from '@/lib/work-api';

import { CercleCoche } from './elements';
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
    <div role="search" aria-label="Filtrer les tâches" className="flex flex-col gap-2">
      <FormGrid>
        <Field id={id('q')} label="Filtrer" size="lg">
          <TextInput
            type="search"
            value={filtres.texte}
            onChange={(e) => onChange({ ...filtres, texte: e.target.value })}
            placeholder="Titre ou #numéro"
            leading={<Search aria-hidden="true" className="h-4 w-4" />}
          />
        </Field>
        <Field id={id('resp')} label="Responsable" size="md">
          <Select<string>
            value={filtres.responsable}
            onChange={(v) => onChange({ ...filtres, responsable: v })}
            options={[
              { value: '', label: 'Tous' },
              { value: 'aucun', label: 'Sans responsable' },
              ...members.map((m) => ({ value: m.userId, label: m.name })),
            ]}
          />
        </Field>
        {labels.length > 0 ? (
          <Field id={id('etiq')} label="Étiquette" size="sm">
            <Select<string>
              value={filtres.etiquette}
              onChange={(v) => onChange({ ...filtres, etiquette: v })}
              options={[
                { value: '', label: 'Toutes' },
                ...labels.map((l) => ({ value: l.key, label: l.label })),
              ]}
            />
          </Field>
        ) : null}
        <Field id={id('prio')} label="Priorité" size="sm">
          <Select<FiltresTaches['priorite']>
            value={filtres.priorite}
            onChange={(v) => onChange({ ...filtres, priorite: v })}
            options={[
              { value: '', label: 'Toutes' },
              ...(Object.keys(PRIORITES) as (keyof typeof PRIORITES)[]).map((p) => ({
                value: p,
                label: PRIORITES[p].label,
              })),
            ]}
          />
        </Field>
      </FormGrid>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Switch
          checked={filtres.masquerTerminees}
          onChange={(v) => onChange({ ...filtres, masquerTerminees: v })}
          label="Masquer les terminées"
        />
        {filtresActifs(filtres) ? (
          <Button size="sm" onClick={() => onChange(filtresVides())}>
            Effacer les filtres
          </Button>
        ) : null}
      </div>
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
      <TextInput
        id={id}
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        placeholder={compact ? '+ Tâche' : 'Ajouter une tâche…'}
        maxLength={300}
        className="min-w-0 flex-1"
      />
      <Button type="submit" busy={envoi} disabled={titre.trim() === ''}>
        Ajouter
      </Button>
    </form>
  );
}

/**
 * « + Ajouter une tâche » en ligne, en bas d'un groupe (Liste) ou d'une colonne
 * (Tableau) : un clic ouvre le champ ; Entrée crée la tâche et garde le champ
 * ouvert pour enchaîner ; Échap ou un champ vide quitté referme.
 */
export function AjoutEnLigne({
  columnKey,
  idPrefixe,
  variante = 'ligne',
}: {
  columnKey: string;
  idPrefixe: string;
  variante?: 'ligne' | 'carte';
}): React.ReactElement | null {
  const { projectId, travailler, appliquerEcriture, signalerErreur } = useProjet();
  const [ouvert, setOuvert] = useState(false);
  const [titre, setTitre] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  if (!travailler) return null;

  async function ajouter(): Promise<void> {
    const t = titre.trim();
    if (!t) return;
    // Le champ se vide aussitôt : on peut taper la suivante pendant l'envoi.
    setTitre('');
    setEnvoi(true);
    try {
      appliquerEcriture(await workApi.createTask(projectId, { title: t, columnKey }));
    } catch (err) {
      setTitre((courant) => (courant === '' ? t : courant));
      signalerErreur(err, 'Création de la tâche impossible.');
    } finally {
      setEnvoi(false);
    }
  }

  const id = `${idPrefixe}-ajout-ligne`;
  const ligne = variante === 'ligne';
  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => {
          setOuvert(true);
          requestAnimationFrame(() => champ.current?.focus());
        }}
        className={
          ligne
            ? 'flex h-[var(--row-h)] w-full items-center gap-2 px-3 text-left text-sm text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-muted)] hover:text-[var(--foreground)] sm:pl-9'
            : 'flex w-full items-center gap-1.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-sm text-[var(--foreground-muted)] transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]'
        }
      >
        <span aria-hidden="true">+</span> Ajouter une tâche
      </button>
    );
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ajouter();
      }}
      className={
        ligne
          ? 'flex h-[var(--row-h)] items-center gap-2 px-3 sm:pl-9'
          : 'flex flex-col gap-1.5 rounded-[var(--radius-md)] border border-[var(--accent)] bg-[var(--surface)] p-2'
      }
    >
      <label htmlFor={id} className="sr-only">
        Nom de la nouvelle tâche
      </label>
      <input
        id={id}
        ref={champ}
        value={titre}
        onChange={(e) => setTitre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setTitre('');
            setOuvert(false);
          }
        }}
        onBlur={() => {
          if (titre.trim() === '' && !envoi) setOuvert(false);
        }}
        placeholder="Nom de la tâche, puis Entrée"
        maxLength={300}
        className={
          ligne
            ? 'h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[var(--accent)] bg-[var(--surface)] px-2 text-sm outline-none'
            : 'min-w-0 bg-transparent text-sm outline-none'
        }
      />
      <span className="sr-only" aria-live="polite">
        {envoi ? 'Création…' : ''}
      </span>
    </form>
  );
}

/** Case « terminée » : terminer (colonne `done`) ou rouvrir (première `todo`). */
export function CaseTerminee({
  task,
  taille,
}: {
  task: WorkTaskView;
  taille?: 16 | 18 | 22;
}): React.ReactElement {
  const { travailler, appliquerEcriture, signalerErreur } = useProjet();
  const [envoi, setEnvoi] = useState(false);
  // Affichage optimiste : le cercle se coche tout de suite, la réponse fait foi.
  const [optimiste, setOptimiste] = useState<boolean | null>(null);
  async function basculer(): Promise<void> {
    setEnvoi(true);
    setOptimiste(!task.done);
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
      setOptimiste(null);
    }
  }
  return (
    <CercleCoche
      coche={optimiste ?? task.done}
      taille={taille}
      disabled={!travailler || envoi}
      onClick={() => void basculer()}
      label={
        task.done
          ? `Rouvrir #${task.number} ${task.title}`
          : `Terminer #${task.number} ${task.title}`
      }
    />
  );
}
