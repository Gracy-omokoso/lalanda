// Doublure en mémoire du journal `edef_exchanges` — pour les tests (ADR-0024 F1).
//
// Le client e-MCF se teste sans MongoDB : ce journal garde les entrées dans un
// tableau et sait simuler une panne de l'écriture STRICTE (`failStrict`), pour
// prouver qu'aucune requête ne part quand l'entrée `request` n'est pas écrite.
// `onStrict` est appelé au moment de l'écriture stricte : un test peut y relever
// l'état du faux serveur (« rien n'était encore reçu »).

import { EdefExchangeJournal, type EdefExchangeEntry } from '../edef-exchange.journal.js';

export class MemoryEdefExchangeJournal extends EdefExchangeJournal {
  readonly entries: EdefExchangeEntry[] = [];
  /** Vrai : `appendStrict` lève sans rien écrire. */
  failStrict = false;
  onStrict: ((entry: EdefExchangeEntry) => void) | null = null;

  async append(entry: EdefExchangeEntry): Promise<void> {
    this.entries.push(entry);
  }

  async appendStrict(entry: EdefExchangeEntry): Promise<void> {
    if (this.failStrict) throw new Error('panne simulée du journal');
    this.onStrict?.(entry);
    this.entries.push(entry);
  }

  /** Entrées d'un échange, dans l'ordre d'écriture. */
  byExchange(exchangeId: string): EdefExchangeEntry[] {
    return this.entries.filter((e) => e.exchangeId === exchangeId);
  }
}
