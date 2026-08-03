// Extraction des identifiants (driver.id ou ligne.id) référencés dans une formule DSL.
// S1 : formules purement arithmétiques (+ - * / ^ ( )) + littéraux numériques + identifiants snake_case.
// Aucune fonction custom, aucun appel de fonction.

// Regex identifiant DSL : conforme à IdSchema (dsl/schema.ts).
const ID_REGEX = /\b([a-z][a-z0-9_]*)\b/g;

// Petites listes de mots-clés qu'on ignore si un jour ils apparaissent (ex : `true`/`false`).
// En S1 ils ne devraient pas exister — mais mieux vaut être tolérant.
const RESERVED = new Set(['true', 'false', 'null']);

/**
 * Retourne l'ensemble des identifiants distincts référencés par la formule source.
 * L'appelant croise ensuite avec la liste des drivers et des lignes du template
 * pour distinguer "référence à un driver" vs "référence à une autre ligne".
 */
export function extractReferencedIds(formule: string): ReadonlySet<string> {
  const found = new Set<string>();
  const matches = formule.matchAll(ID_REGEX);
  for (const m of matches) {
    const id = m[1];
    if (id && !RESERVED.has(id)) found.add(id);
  }
  return found;
}
