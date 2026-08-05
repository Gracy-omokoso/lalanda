// Extraction des identifiants (driver.id ou ligne.id) référencés dans une formule DSL.
// S1  : formules purement arithmétiques (+ - * / ^ ( )) + littéraux + identifiants snake_case.
// S10 : ajoute le support des fonctions Excel natives (MAX, MIN, IF, ABS, ROUND, SUM,
//       IFERROR, AND, OR, NOT). Le compilateur les préserve intactes ; HyperFormula les
//       évalue nativement à l'exécution (voir evaluator/index.ts).

// Regex identifiant DSL : conforme à IdSchema (dsl/schema.ts).
const ID_REGEX = /\b([a-z][a-z0-9_]*)\b/g;

// Identifiants qui ne référencent PAS un driver/ligne — ne pas les résoudre.
// - Mots-clés booléens
// - Fonctions Excel natives supportées par HyperFormula (nom en minuscules puisque
//   ID_REGEX ne matche que le minuscule ; en pratique les templates écrivent MAX/IF
//   mais la comparaison se fait insensible plus bas).
const RESERVED = new Set([
  'true',
  'false',
  'null',
  // Fonctions Excel natives autorisées.
  'max',
  'min',
  'if',
  'abs',
  'round',
  'sum',
  'iferror',
  'and',
  'or',
  'not',
]);

/**
 * Retourne l'ensemble des identifiants distincts référencés par la formule source.
 * L'appelant croise ensuite avec la liste des drivers et des lignes du template
 * pour distinguer "référence à un driver" vs "référence à une autre ligne".
 */
export function extractReferencedIds(formule: string): ReadonlySet<string> {
  // On matche les identifiants en majuscules ET minuscules pour tolérer `MAX(...)` (usage
  // courant) comme `max(...)` (bien que le DSL doc utilise MAJUSCULES). Comparaison
  // insensible avec `RESERVED` (qui contient les minuscules).
  const lower = formule.toLowerCase();
  const found = new Set<string>();
  const matches = lower.matchAll(ID_REGEX);
  for (const m of matches) {
    const id = m[1];
    if (id && !RESERVED.has(id)) found.add(id);
  }
  return found;
}
