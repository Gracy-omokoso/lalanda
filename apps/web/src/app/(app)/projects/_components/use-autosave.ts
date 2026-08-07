'use client';

// Auto-save débouncé du wizard (S18c — WIZ-002).
//
// Contrat : dès qu'une valeur change, on planifie un enregistrement après `delay` ms
// d'inactivité. Les frappes successives ne déclenchent qu'un seul appel réseau.
// Une erreur n'est jamais avalée : elle est exposée dans l'état pour affichage et
// la dernière charge utile reste disponible pour un nouvel essai (`retry`).
//
// Conformément à docs/06-WIZARD.md, la sauvegarde n'est PAS conditionnée à la
// validité des saisies : « les erreurs bloquantes empêchent la validation, pas la
// sauvegarde ». Seule la validation finale du plan est bloquée.

import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export interface SaveState {
  status: SaveStatus;
  /** Horodatage ISO du dernier enregistrement réussi. */
  savedAt: string | null;
  /** Message d'erreur du dernier échec, sinon `null`. */
  error: string | null;
}

interface UseAutosaveOptions<T> {
  /** Charge utile courante — comparée par sérialisation JSON pour détecter un changement. */
  value: T;
  /** Enregistrement effectif (appel API). */
  save: (value: T) => Promise<void>;
  /** Actif seulement une fois les données initiales chargées. */
  enabled: boolean;
  /** Délai d'inactivité avant enregistrement (ms). */
  delay?: number;
}

export interface UseAutosaveResult {
  state: SaveState;
  /** Relance l'enregistrement de la dernière charge utile après une erreur. */
  retry: () => void;
  /** Enregistre immédiatement si des modifications sont en attente (avant export, validation…). */
  flush: () => Promise<void>;
}

export function useAutosave<T>({
  value,
  save,
  enabled,
  delay = 800,
}: UseAutosaveOptions<T>): UseAutosaveResult {
  const [state, setState] = useState<SaveState>({
    status: 'idle',
    savedAt: null,
    error: null,
  });

  // Refs : le timer ne doit dépendre ni de l'identité de `save` ni de celle de `value`.
  const valueRef = useRef(value);
  const saveRef = useRef(save);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernière charge utile réellement enregistrée — évite un appel réseau inutile
  // lorsque l'utilisateur revient à la valeur d'origine.
  const savedSnapshotRef = useRef<string | null>(null);

  valueRef.current = value;
  saveRef.current = save;

  const run = useCallback(async () => {
    const snapshot = JSON.stringify(valueRef.current);
    setState((s) => ({ ...s, status: 'saving', error: null }));
    try {
      await saveRef.current(valueRef.current);
      savedSnapshotRef.current = snapshot;
      setState({ status: 'saved', savedAt: new Date().toISOString(), error: null });
    } catch (err) {
      setState((s) => ({
        ...s,
        status: 'error',
        error: err instanceof Error ? err.message : 'Enregistrement impossible',
      }));
    }
  }, []);

  const serialized = JSON.stringify(value);

  useEffect(() => {
    if (!enabled) return;
    // Premier passage : on mémorise l'état serveur sans déclencher d'écriture.
    if (savedSnapshotRef.current === null) {
      savedSnapshotRef.current = serialized;
      return;
    }
    if (savedSnapshotRef.current === serialized) return;

    setState((s) => ({ ...s, status: 'pending' }));
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void run(), delay);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [serialized, enabled, delay, run]);

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void run();
  }, [run]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (savedSnapshotRef.current === JSON.stringify(valueRef.current)) return;
    await run();
  }, [run]);

  return { state, retry, flush };
}

/** Libellé court de l'état d'enregistrement, affiché à côté du wizard. */
export function saveStatusLabel(state: SaveState): string {
  switch (state.status) {
    case 'pending':
      return 'Modifications non enregistrées…';
    case 'saving':
      return 'Enregistrement…';
    case 'saved':
      return state.savedAt
        ? `Enregistré à ${new Date(state.savedAt).toLocaleTimeString('fr-FR')}`
        : 'Enregistré';
    case 'error':
      return state.error ?? 'Enregistrement impossible';
    case 'idle':
      return 'Aucune modification';
  }
}
