// Erreurs codifiées du moteur — chaque erreur porte un code stable pour l'UI et l'audit.

export type EngineErrorCode =
  | 'DSL_PARSE_ERROR'
  | 'DSL_SCHEMA_ERROR'
  | 'DUPLICATE_ID'
  | 'UNKNOWN_DRIVER'
  | 'UNKNOWN_LINE'
  | 'CYCLE'
  | 'INVALID_FORMULA'
  | 'MISSING_DRIVER_VALUE'
  | 'UNKNOWN_GROUPE';

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: EngineErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.details = details;
  }
}

/** Un identifiant (driver, ligne, feuille, groupe, étape) apparaît plus d'une fois. */
export class DuplicateIdError extends EngineError {
  constructor(kind: 'driver' | 'ligne' | 'feuille' | 'groupe' | 'etape', id: string) {
    super('DUPLICATE_ID', `Identifiant ${kind} en double : "${id}"`, { kind, id });
  }
}

/** (S18c) Une étape du wizard rattache un groupe d'hypothèses qui n'existe pas. */
export class UnknownGroupeError extends EngineError {
  constructor(groupeId: string, etapeId: string) {
    super(
      'UNKNOWN_GROUPE',
      `L'étape "${etapeId}" référence un groupe d'hypothèses inconnu : "${groupeId}"`,
      { groupeId, etapeId },
    );
  }
}

/** Une formule référence un driver qui n'existe pas dans le template. */
export class UnknownDriverError extends EngineError {
  constructor(driverId: string, lineId: string) {
    super(
      'UNKNOWN_DRIVER',
      `La formule de la ligne "${lineId}" référence un driver inconnu : "${driverId}"`,
      { driverId, lineId },
    );
  }
}

/** Une formule référence une ligne qui n'existe pas dans le template. */
export class UnknownLineError extends EngineError {
  constructor(referencedLineId: string, fromLineId: string) {
    super(
      'UNKNOWN_LINE',
      `La formule de la ligne "${fromLineId}" référence une ligne inconnue : "${referencedLineId}"`,
      { referencedLineId, fromLineId },
    );
  }
}

/** Le graphe de dépendances contient un cycle. Le champ `path` contient le chemin fautif. */
export class CycleError extends EngineError {
  constructor(path: readonly string[]) {
    super('CYCLE', `Cycle détecté dans les formules : ${path.join(' → ')}`, { path: [...path] });
  }
}

/** Une valeur de driver requise n'a pas été fournie au moment de l'évaluation. */
export class MissingDriverValueError extends EngineError {
  constructor(driverId: string) {
    super('MISSING_DRIVER_VALUE', `Valeur manquante pour le driver "${driverId}"`, { driverId });
  }
}
