// Migration du 31 oct. 2026 — fiches fournisseurs depuis les dépenses texte
// (ADR-0044 § 2.9, lot P2).
//
// ── Ce qu'elle fait, par organisation ─────────────────────────────────────────
//
// 1. Regroupe les fournisseurs TEXTE des dépenses (`treasury_expenses.supplierKey`,
//    à défaut le nom normalisé) et des règles récurrentes
//    (`treasury_recurring_expenses.supplierName`, normalisé) par CLÉ EXACTE —
//    minuscules, sans accents, espaces réduits ; AUCUN rapprochement approché :
//    « SOCIMEX » et « Socimex » donnent une fiche, « Socimex » et « Socimex SARL »
//    deux.
// 2. Une fiche `suppliers` par groupe : nom = la graphie la plus fréquente (à
//    égalité : la plus ancienne, puis l'ordre alphabétique), `legacyKeys = [clé]`,
//    devise par défaut = la plus fréquente du groupe, conditions `immediate`,
//    catégorie par défaut = la plus fréquente. Une fiche qui porte déjà la clé dans
//    `legacyKeys` (passage précédent, fusion faite depuis) est RÉUTILISÉE.
// 3. `supplierId` posé sur les dépenses et règles du groupe ; `supplierName` et
//    `supplierKey` INCHANGÉS (copie d'affichage, recherche).
// 4. Rapport à relire (`supplier_migration_reports`, servi par
//    `GET /purchases/suppliers/migration-report`) : fiches créées, graphies par
//    fiche, dépenses et règles rattachées. Les doublons réels se fusionnent ensuite
//    à l'écran (`POST /purchases/suppliers/:id/merge`).
//
// ── Idempotence ───────────────────────────────────────────────────────────────
//
// Une dépense ou une règle n'est traitée que si elle n'a PAS de champ `supplierId`
// (l'API, depuis ce lot, le pose toujours, `null` compris). Une fois rattachée,
// elle n'est plus sélectionnée ; les fiches existantes sont réutilisées par leur
// clé. Un second passage ne crée rien, n'écrit rien et ne produit pas de rapport
// (test : `src/__tests__/purchase-suppliers-migration.e2e.test.ts`).
//
// Compatibilité N-1 (README, règle 3) : l'ancienne API ignore `suppliers` et le
// champ ajouté. Jouable avant ou après le déploiement ; rejouer APRÈS rattrape les
// dépenses écrites par une ancienne instance pendant la bascule.
//
// Exécution :
//   node --env-file=.env.production apps/api/migrations/run.mjs 20261031-0001-suppliers-from-expenses

const NAME = '20261031-0001-suppliers-from-expenses';
const REPORTS = 'supplier_migration_reports';
/** Auteur des écritures — même valeur que `SUPPLIERS_SYSTEM_ACTOR` (`supplier.schema.ts`). */
export const SYSTEM_ACTOR = 'system:suppliers-migration';
const BATCH = 500;

/**
 * MIROIR de `normalizeForSearch` (`src/sales/search.ts`), qui produit
 * `supplierKey` : une migration ne dépend pas du code applicatif (README). Un test
 * vérifie que les deux donnent le même résultat.
 * @param {string} value
 */
export function normalizeName(value) {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Miroir de `searchKeyOf` (`src/sales/search.ts`). @param {Array<string | null | undefined>} parts */
export function searchKeyOf(parts) {
  return parts
    .filter((p) => typeof p === 'string' && p.trim() !== '')
    .map(normalizeName)
    .join(' ');
}

/** @param {Map<string, number>} counts @returns {string | null} le plus fréquent, à égalité le premier par ordre alphabétique */
function mostFrequent(counts) {
  let best = null;
  let bestCount = 0;
  for (const [value, count] of [...counts.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Regroupe des saisies texte par clé exacte. Pur et déterministe.
 * @param {Array<{ name: string, key?: string | null, createdAt: Date, currency?: string | null, category?: string | null }>} entries
 * @returns {Map<string, { key: string, name: string, spellings: Array<{ name: string, count: number }>, currency: string | null, category: string | null }>}
 */
export function groupSupplierNames(entries) {
  /** @type {Map<string, { first: Map<string, Date>, counts: Map<string, number>, currencies: Map<string, number>, categories: Map<string, number> }>} */
  const raw = new Map();
  for (const e of entries) {
    const name = e.name.trim();
    const key = typeof e.key === 'string' && e.key !== '' ? e.key : normalizeName(name);
    if (key === '' || name === '') continue;
    let g = raw.get(key);
    if (!g) {
      g = { first: new Map(), counts: new Map(), currencies: new Map(), categories: new Map() };
      raw.set(key, g);
    }
    g.counts.set(name, (g.counts.get(name) ?? 0) + 1);
    const seen = g.first.get(name);
    if (!seen || e.createdAt < seen) g.first.set(name, e.createdAt);
    if (e.currency === 'CDF' || e.currency === 'USD') {
      g.currencies.set(e.currency, (g.currencies.get(e.currency) ?? 0) + 1);
    }
    if (typeof e.category === 'string' && e.category !== '') {
      g.categories.set(e.category, (g.categories.get(e.category) ?? 0) + 1);
    }
  }
  const out = new Map();
  for (const [key, g] of [...raw.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const spellings = [...g.counts.entries()]
      .map(([name, count]) => ({ name, count, first: g.first.get(name) }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          a.first.getTime() - b.first.getTime() ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );
    out.set(key, {
      key,
      name: spellings[0].name,
      spellings: spellings.map(({ name, count }) => ({ name, count })),
      currency: mostFrequent(g.currencies),
      category: mostFrequent(g.categories),
    });
  }
  return out;
}

/** @param {import('mongodb').Collection} col @param {import('mongodb').AnyBulkWriteOperation[]} ops */
async function flush(col, ops) {
  let n = 0;
  for (let i = 0; i < ops.length; i += BATCH) {
    const res = await col.bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
    n += res.modifiedCount;
  }
  return n;
}

/**
 * Index de `suppliers` et de la dépense — mêmes clés et options que les schémas
 * Mongoose (`supplier.schema.ts`, `treasury.schemas.ts`), sans quoi le démarrage de
 * l'API les refuserait comme conflictuels.
 * @param {import('mongodb').Db} db
 */
async function ensureIndexes(db) {
  const suppliers = db.collection('suppliers');
  await suppliers.createIndex({ organizationId: 1, sortName: 1, _id: 1 });
  await suppliers.createIndex({ organizationId: 1, active: 1 });
  await suppliers.createIndex(
    { organizationId: 1, nif: 1 },
    {
      unique: true,
      partialFilterExpression: { nif: { $type: 'string' } },
      name: 'supplier_nif_unique',
    },
  );
  await suppliers.createIndex({ organizationId: 1, legacyKeys: 1 });
  await suppliers.createIndex({ organizationId: 1, 'paymentMethods.fingerprint': 1 });
  await db
    .collection('treasury_expenses')
    .createIndex(
      { organizationId: 1, supplierId: 1, spentOn: 1 },
      { partialFilterExpression: { supplierId: { $type: 'string' } } },
    );
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} organizationId
 * @param {Date} now
 */
async function migrateOrganization(db, organizationId, now) {
  const suppliers = db.collection('suppliers');
  const expensesCol = db.collection('treasury_expenses');
  const rulesCol = db.collection('treasury_recurring_expenses');
  const pending = { supplierName: { $type: 'string' }, supplierId: { $exists: false } };

  const expenses = await expensesCol
    .find(
      { organizationId, ...pending },
      { projection: { supplierName: 1, supplierKey: 1, currency: 1, category: 1, createdAt: 1 } },
    )
    .toArray();
  const rules = await rulesCol
    .find(
      { organizationId, ...pending },
      { projection: { supplierName: 1, currency: 1, category: 1, createdAt: 1 } },
    )
    .toArray();

  /** @param {{ supplierName: string, supplierKey?: string | null }} d */
  const keyOf = (d) =>
    typeof d.supplierKey === 'string' && d.supplierKey !== ''
      ? d.supplierKey
      : normalizeName(d.supplierName);

  const entries = [...expenses, ...rules]
    .filter((d) => d.supplierName.trim() !== '')
    .map((d) => ({
      name: d.supplierName,
      key: keyOf(d),
      createdAt: d.createdAt instanceof Date ? d.createdAt : now,
      currency: d.currency ?? null,
      category: d.category ?? null,
    }));

  const report = {
    suppliersCreated: 0,
    expensesLinked: 0,
    recurringLinked: 0,
    suppliers:
      /** @type {Array<{ supplierId: string, name: string, spellings: string[], expenses: number }>} */ ([]),
  };

  /** @type {Map<string, string>} clé → identifiant de fiche */
  const supplierOf = new Map();
  for (const group of groupSupplierNames(entries).values()) {
    const existing = await suppliers.findOne(
      { organizationId, legacyKeys: group.key, mergedInto: null },
      { sort: { _id: 1 }, projection: { _id: 1 } },
    );
    if (existing) {
      supplierOf.set(group.key, String(existing._id));
      continue;
    }
    const res = await suppliers.insertOne({
      organizationId,
      name: group.name,
      sortName: normalizeName(group.name),
      searchKey: searchKeyOf([group.name]),
      kind: 'company',
      nif: null,
      rccm: null,
      nationalId: null,
      address: null,
      phone: null,
      email: null,
      website: null,
      contacts: [],
      defaultCurrency: group.currency,
      paymentTerms: { kind: 'immediate' },
      defaultCategory: group.category,
      paymentMethods: [],
      paymentDetailsChangedAt: null,
      paymentDetailsChangedBy: null,
      notes: null,
      active: true,
      legacyKeys: [group.key],
      mergedInto: null,
      revision: 1,
      createdBy: SYSTEM_ACTOR,
      updatedBy: SYSTEM_ACTOR,
      createdAt: now,
      updatedAt: now,
      _schemaVersion: 1,
    });
    const supplierId = String(res.insertedId);
    supplierOf.set(group.key, supplierId);
    report.suppliersCreated += 1;
    report.suppliers.push({
      supplierId,
      name: group.name,
      spellings: group.spellings.map((s) => s.name),
      expenses: 0,
    });
  }

  /** @type {Map<string, number>} */
  const linkedBySupplier = new Map();
  const expenseOps = [];
  for (const e of expenses) {
    const supplierId = supplierOf.get(keyOf(e));
    if (!supplierId) continue;
    linkedBySupplier.set(supplierId, (linkedBySupplier.get(supplierId) ?? 0) + 1);
    expenseOps.push({
      updateOne: {
        filter: { _id: e._id, supplierId: { $exists: false } },
        update: { $set: { supplierId } },
      },
    });
  }
  report.expensesLinked = await flush(expensesCol, expenseOps);

  const ruleOps = [];
  for (const r of rules) {
    const supplierId = supplierOf.get(keyOf(r));
    if (!supplierId) continue;
    ruleOps.push({
      updateOne: {
        filter: { _id: r._id, supplierId: { $exists: false } },
        update: { $set: { supplierId } },
      },
    });
  }
  report.recurringLinked = await flush(rulesCol, ruleOps);

  for (const s of report.suppliers) s.expenses = linkedBySupplier.get(s.supplierId) ?? 0;
  return report;
}

/**
 * @param {import('mongodb').Db} db
 * @param {{ now?: Date, quiet?: boolean }} [options]
 * @returns {Promise<{ organizations: number, reports: number, suppliersCreated: number, expensesLinked: number, recurringLinked: number }>}
 */
export async function up(db, options = {}) {
  const now = options.now ?? new Date();
  const log = options.quiet ? () => {} : (/** @type {string} */ m) => console.log(`[${NAME}] ${m}`);
  await ensureIndexes(db);

  const orgs = new Set();
  for (const col of ['treasury_expenses', 'treasury_recurring_expenses']) {
    for (const id of await db
      .collection(col)
      .distinct('organizationId', { supplierName: { $type: 'string' } })) {
      if (typeof id === 'string') orgs.add(id);
    }
  }
  const summary = {
    organizations: 0,
    reports: 0,
    suppliersCreated: 0,
    expensesLinked: 0,
    recurringLinked: 0,
  };
  for (const organizationId of [...orgs].sort()) {
    const report = await migrateOrganization(db, organizationId, now);
    summary.organizations += 1;
    summary.suppliersCreated += report.suppliersCreated;
    summary.expensesLinked += report.expensesLinked;
    summary.recurringLinked += report.recurringLinked;
    if (report.suppliersCreated + report.expensesLinked + report.recurringLinked === 0) continue;
    await db
      .collection(REPORTS)
      .insertOne({ organizationId, migration: NAME, ranAt: now, ...report });
    summary.reports += 1;
    log(
      `${organizationId} : ${report.suppliersCreated} fiches créées, ` +
        `${report.expensesLinked} dépenses et ${report.recurringLinked} règles rattachées`,
    );
  }
  await db.collection(REPORTS).createIndex({ organizationId: 1, migration: 1, ranAt: -1 });
  await db
    .collection('_migrations')
    .updateOne({ name: NAME }, { $set: { name: NAME, appliedAt: now } }, { upsert: true });
  log(`${summary.organizations} organisations, ${summary.reports} rapports`);
  return summary;
}

/**
 * Retour arrière : RIEN n'est défait dans les données. L'ancienne API ignore
 * `suppliers` et `supplierId` (compatibilité N-1) ; les retirer effacerait aussi ce
 * que l'application a écrit depuis (fiches saisies, coordonnées, fusions). Seules
 * la trace et les rapports sont retirés.
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  await db.collection(REPORTS).deleteMany({ migration: NAME });
  await db.collection('_migrations').deleteOne({ name: NAME });
}
