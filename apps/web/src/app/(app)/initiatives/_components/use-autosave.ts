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
// sauvegarde ». Seules la validation d'un plan et les exports sont bloqués.
//
// Deux garanties ajoutées après revue CTO S18c :
//  - aucune perte de saisie : le démontage vide la file, et `beforeunload` avertit
//    tant qu'un enregistrement reste en attente (docs/06 § Critères : « aucune perte
//    après actualisation ou déconnexion »);
//  - aucune réponse périmée : les enregistrements sont numérotés et une réponse
//    doublée par une plus récente est ignorée, pour ne jamais marquer « enregistré »
//    un instantané qui ne l'est pas.

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
  /** `true` tant qu'une modification n'est pas confirmée côté serveur. */
  hasUnsaved: boolean;
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
  // Numéro du dernier enregistrement lancé, et promesse en vol s'il y en a une.
  const seqRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  valueRef.current = value;
  saveRef.current = save;

  const run = useCallback(async (): Promise<void> => {
    // Un seul enregistrement à la fois : on attend celui en cours avant d'en lancer
    // un nouveau, sinon deux réponses concurrentes peuvent se croiser et réécrire
    // `savedSnapshotRef` avec un instantané périmé.
    const previous = inFlightRef.current;
    if (previous) await previous.catch(() => undefined);

    const seq = ++seqRef.current;
    const snapshot = JSON.stringify(valueRef.current);
    if (savedSnapshotRef.current === snapshot) return;

    setState((s) => ({ ...s, status: 'saving', error: null }));
    const attempt = (async () => {
      try {
        await saveRef.current(valueRef.current);
        // Réponse doublée par un enregistrement plus récent → on l'ignore.
        if (seq !== seqRef.current) return;
        savedSnapshotRef.current = snapshot;
        setState({ status: 'saved', savedAt: new Date().toISOString(), error: null });
      } catch (err) {
        if (seq !== seqRef.current) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: err instanceof Error ? err.message : 'Enregistrement impossible',
        }));
      }
    })();
    inFlightRef.current = attempt;
    await attempt;
    if (inFlightRef.current === attempt) inFlightRef.current = null;
  }, []);

  const serialized = JSON.stringify(value);
  const hasUnsaved =
    enabled && savedSnapshotRef.current !== null && savedSnapshotRef.current !== serialized;

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

  // Filet anti-perte n°1 : quitter/recharger l'onglet avec une saisie en attente
  // déclenche la confirmation native du navigateur.
  useEffect(() => {
    if (!hasUnsaved) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      // Requis par Chrome pour afficher la boîte de dialogue.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsaved]);

  // Filet anti-perte n°2 : navigation interne (un <Link> démonte le composant avant
  // l'expiration du debounce) → on enregistre immédiatement au démontage.
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (
        savedSnapshotRef.current !== null &&
        savedSnapshotRef.current !== JSON.stringify(valueRef.current)
      ) {
        void run();
      }
    };
  }, [run]);

  const retry = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    void run();
  }, [run]);

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await run();
  }, [run]);

  return { state, retry, flush, hasUnsaved };
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
