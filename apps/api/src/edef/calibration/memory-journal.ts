// Journal en mémoire de l'outil d'étalonnage — ADR-0024 § 7.2 (chantier F4).
//
// L'outil tourne hors de l'application (aucune base) : le client e-MCF reçoit un
// journal qui garde les entrées EN MÉMOIRE, le temps de l'exécution, puis les
// oublie. Rien n'est écrit sur disque ; le rapport de l'outil est la seule trace
// conservée (sans jeton, sans NIF, sans corps de requête).
//
// Un `Proxy` plutôt qu'une sous-classe : toute méthode d'écriture du journal
// (`append`, et celles que le client e-MCF ajoute pour la facturation) est
// acceptée et enregistrée, sans lier l'outil au détail de leurs noms.

import type { EdefExchangeJournal } from '../edef-exchange.journal.js';

export interface MemoryJournal {
  journal: EdefExchangeJournal;
  /** Entrées reçues, dans l'ordre (méthode du journal appelée, et l'entrée). */
  entries: { method: string; entry: unknown }[];
}

export function createMemoryJournal(): MemoryJournal {
  const entries: MemoryJournal['entries'] = [];
  const journal = new Proxy(Object.create(null) as object, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      return async (entry: unknown) => {
        entries.push({ method: prop, entry });
      };
    },
  }) as EdefExchangeJournal;
  return { journal, entries };
}
