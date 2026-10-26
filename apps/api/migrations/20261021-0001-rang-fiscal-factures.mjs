// Migration du 21 oct. 2026 — rang fiscal des factures (ADR-0027, amendement du
// 21 oct. 2026, question n° 5 de la section « Conséquences »).
//
// ── Ce qu'elle fait ───────────────────────────────────────────────────────────
//
// 1. Renseigne `fiscalSeq` (rang numérique du numéro dans la série de l'année)
//    et, s'il manque, `fiscalYear`, sur chaque document de vente qui porte un
//    numéro définitif (`number`, séries `real` et `test`). Le rang et l'année
//    sont LUS DANS LE NUMÉRO, sous ses deux formes :
//      - ancienne : `AAAA-NNNNNN`, `TEST-AAAA-NNNNNN` (ADR-0023) ;
//      - actuelle : `IN{AA}{MM}-NNNNNN`, `AV…`, `TEST-IN…`, `TEST-AV…` (ADR-0027).
// 2. Crée l'index unique partiel { organizationId, series, fiscalYear, fiscalSeq }
//    (`fiscalSeq` numérique seulement) — le même que celui déclaré dans
//    `invoice.schema.ts`, que `IndexesService` crée aussi au démarrage.
//
// ── Ce qu'elle ne fait PAS ────────────────────────────────────────────────────
//
// Elle ne touche ni `number`, ni `contentSha256`, ni aucun champ figé : seuls
// `fiscalSeq` (nouveau) et `fiscalYear` (s'il est absent) sont écrits. Le rang
// n'entre pas dans l'empreinte (`canonical.ts` : champs figés seulement).
//
// ── Idempotence ───────────────────────────────────────────────────────────────
//
// Le filtre ne sélectionne que les documents numérotés SANS `fiscalSeq`
// numérique : une seconde exécution n'écrit rien. Un numéro illisible est
// signalé et laissé tel quel (la migration échoue à la fin, code non nul, pour
// qu'on le voie). Deux documents de même rang (impossible si le compteur a fait
// son travail) font échouer la création de l'index : à examiner à la main, rien
// n'est réécrit.
//
// Ordre de déploiement : indifférent (compatibilité N-1). L'API qui démarre
// avant la migration crée l'index sur les seuls documents qui ont déjà un rang ;
// la migration complète ensuite, sous la protection de l'index.
//
// Exécution :
//   node --env-file=.env.production apps/api/migrations/run.mjs 20261021-0001-rang-fiscal-factures

const NAME = '20261021-0001-rang-fiscal-factures';

/** `AAAA-NNNNNN` ou `TEST-AAAA-NNNNNN` (ADR-0023). */
const LEGACY = /^(TEST-)?(\d{4})-(\d{6,})$/;
/** `IN|AV{AA}{MM}-NNNNNN`, préfixe `TEST-` facultatif (ADR-0027). */
const CURRENT = /^(TEST-)?(IN|AV)(\d{2})(\d{2})-(\d{6,})$/;

/**
 * Rang et année d'un numéro définitif ; `null` si illisible. Miroir de
 * `parseInvoiceNumber` (`invoice-numbering.ts`) : une migration ne dépend pas
 * du code applicatif, qui évolue (README).
 * @param {string} number
 * @returns {{ series: 'real' | 'test', year: number, seq: number } | null}
 */
export function rankOf(number) {
  const legacy = LEGACY.exec(number);
  if (legacy) {
    return {
      series: legacy[1] ? 'test' : 'real',
      year: Number(legacy[2]),
      seq: Number(legacy[3]),
    };
  }
  const current = CURRENT.exec(number);
  if (current) {
    const month = Number(current[4]);
    if (month < 1 || month > 12) return null;
    return {
      series: current[1] ? 'test' : 'real',
      year: 2000 + Number(current[3]),
      seq: Number(current[5]),
    };
  }
  return null;
}

/** @param {import('mongodb').Db} db */
export async function up(db) {
  const invoices = db.collection('sales_invoices');
  const cursor = invoices.find(
    {
      number: { $type: 'string' },
      series: { $in: ['real', 'test'] },
      fiscalSeq: { $not: { $type: 'number' } },
    },
    { projection: { _id: 1, number: 1, series: 1, fiscalYear: 1 } },
  );
  let written = 0;
  const unreadable = [];
  for await (const doc of cursor) {
    const rank = rankOf(doc.number);
    if (rank === null || rank.series !== doc.series) {
      unreadable.push(`${doc._id} (${doc.number})`);
      continue;
    }
    if (typeof doc.fiscalYear === 'number' && doc.fiscalYear !== rank.year) {
      unreadable.push(`${doc._id} (${doc.number}, fiscalYear ${doc.fiscalYear})`);
      continue;
    }
    const res = await invoices.updateOne(
      { _id: doc._id, number: doc.number, fiscalSeq: { $not: { $type: 'number' } } },
      { $set: { fiscalSeq: rank.seq, fiscalYear: rank.year } },
    );
    written += res.modifiedCount;
  }

  await invoices.createIndex(
    { organizationId: 1, series: 1, fiscalYear: 1, fiscalSeq: 1 },
    { unique: true, partialFilterExpression: { fiscalSeq: { $type: 'number' } } },
  );

  // eslint-disable-next-line no-console
  console.log(`[${NAME}] sales_invoices : ${written} rang(s) renseigné(s), index en place.`);
  if (unreadable.length > 0) {
    throw new Error(
      `${unreadable.length} numéro(s) illisible(s) ou incohérent(s), laissés tels quels : ${unreadable.join(', ')}`,
    );
  }
  await db
    .collection('_migrations')
    .updateOne({ name: NAME }, { $set: { name: NAME, appliedAt: new Date() } }, { upsert: true });
}

/**
 * Retour arrière : retire l'index. `fiscalSeq` reste (champ ignoré par une API
 * antérieure — compatibilité N-1) : effacer une donnée exacte n'apporte rien.
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  await db
    .collection('sales_invoices')
    .dropIndex('organizationId_1_series_1_fiscalYear_1_fiscalSeq_1')
    .catch(() => undefined);
  await db.collection('_migrations').deleteOne({ name: NAME });
}
