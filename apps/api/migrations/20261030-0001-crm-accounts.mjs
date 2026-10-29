// Migration du 30 oct. 2026 — comptes CRM 360° (ADR-0040 § 2.7, lot C1).
//
// ── Ce qu'elle fait, par organisation ─────────────────────────────────────────
//
// 1. Un compte `customer` par fiche client (actives et désactivées), `ownerId:
//    null`. Clé : l'index unique partiel { organizationId, customerId }.
// 2. Prospects : les `crm_contacts.companyName` (sans client) et les
//    `crm_opportunities.prospectName` (sans client) sont regroupés par NOM
//    NORMALISÉ EXACT (minuscules, sans accents, espaces réduits) — AUCUN
//    rapprochement approché : « ACME Sarl » et « acme  sarl » donnent un compte,
//    « ACME » et « ACME SA » deux. Un compte `prospect` par groupe ; nom = la
//    graphie la plus fréquente (à égalité : la plus ancienne) ; responsable = le
//    créateur de la plus ancienne opportunité du groupe s'il est encore membre,
//    sinon `null`. Un prospect de même nom normalisé qui existe déjà (créé par
//    l'application, ou par un passage précédent) est RÉUTILISÉ.
// 3. `accountId` posé sur les contacts et les opportunités ; sur les activités,
//    déduit de l'opportunité, sinon du contact, sinon du client. `companyName` et
//    `prospectName` recopient le nom du compte (graphie retenue).
// 4. Opportunités : `ownerId = createdBy`, `lostReasonKey: null` (le texte du
//    motif reste en détail). Activités : `assigneeUserId = createdBy` pour une
//    activité à échéance non faite (sinon `null`), `dueDay` = jour de Kinshasa de
//    `dueAt`, `reminders` vides. Champs posés SEULEMENT s'ils manquent.
// 5. Rapport à relire (`crm_migration_reports`, servi par
//    `GET /crm/accounts/migration-report`) : comptes créés, groupes fusionnés par
//    nom avec leurs graphies, contacts sans entreprise, membres introuvables.
//    Les homonymes réels se séparent ensuite à l'écran.
//
// ── Idempotence ───────────────────────────────────────────────────────────────
//
// Un document n'est traité que s'il n'a PAS de champ `accountId` : une fois
// migré, il porte `accountId` (éventuellement `null`) et n'est plus sélectionné.
// Les comptes client sont créés par `$setOnInsert` sur leur clé unique, les
// prospects réutilisent le compte de même nom normalisé. Un second passage ne
// crée rien, n'écrit rien et ne produit pas de rapport (test :
// `src/__tests__/crm-accounts-migration.e2e.test.ts`). `_schemaVersion` passe à 2
// sur les contacts (schéma possédé par ce lot) ; celui des opportunités et des
// activités appartient aux lots C2 et C4 et n'est pas touché.
//
// Compatibilité N-1 (README, règle 3) : l'ancienne API ignore les champs ajoutés.
// Jouable avant ou après le déploiement ; rejouer APRÈS le déploiement rattrape
// les documents écrits par une ancienne instance pendant la bascule.
//
// Exécution :
//   node --env-file=.env.production apps/api/migrations/run.mjs 20261030-0001-crm-accounts

const NAME = '20261030-0001-crm-accounts';
const REPORTS = 'crm_migration_reports';
/** Auteur des écritures de la migration — même valeur que `CRM_ACCOUNTS_SYSTEM_ACTOR`. */
export const SYSTEM_ACTOR = 'system:crm-accounts';
const BATCH = 500;

/**
 * Forme de comparaison — MIROIR de `normalizeForSearch` (`src/sales/search.ts`) :
 * une migration ne dépend pas du code applicatif (README). Un test vérifie que
 * les deux donnent le même résultat.
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

/** Jour civil de Kinshasa (UTC+1, sans heure d'été). @param {Date} at */
export function kinshasaDayOf(at) {
  return new Date(at.getTime() + 3_600_000).toISOString().slice(0, 10);
}

/**
 * Regroupe des noms d'entreprise par nom normalisé exact. Pur et déterministe.
 * @param {Array<{ name: string, createdAt: Date, createdBy?: string | null, source: 'contact' | 'opportunity' }>} entries
 * @returns {Map<string, { key: string, name: string, spellings: Array<{ name: string, count: number }>, owner: string | null }>}
 */
export function groupProspectNames(entries) {
  /** @type {Map<string, { first: Map<string, Date>, counts: Map<string, number>, oldestOpp: { at: Date, by: string | null } | null }>} */
  const raw = new Map();
  for (const e of entries) {
    const name = e.name.trim();
    const key = normalizeName(name);
    if (key === '') continue;
    let g = raw.get(key);
    if (!g) {
      g = { first: new Map(), counts: new Map(), oldestOpp: null };
      raw.set(key, g);
    }
    g.counts.set(name, (g.counts.get(name) ?? 0) + 1);
    const seen = g.first.get(name);
    if (!seen || e.createdAt < seen) g.first.set(name, e.createdAt);
    if (e.source === 'opportunity' && (!g.oldestOpp || e.createdAt < g.oldestOpp.at)) {
      g.oldestOpp = { at: e.createdAt, by: e.createdBy ?? null };
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
      owner: g.oldestOpp?.by ?? null,
    });
  }
  return out;
}

/** @param {unknown} v */
function nonEmpty(v) {
  return typeof v === 'string' && v.trim() !== '';
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

/** @param {import('mongodb').Db} db */
async function ensureIndexes(db) {
  const accounts = db.collection('crm_accounts');
  await accounts.createIndex({ organizationId: 1, sortName: 1, _id: 1 });
  await accounts.createIndex({ organizationId: 1, active: 1, kind: 1 });
  await accounts.createIndex({ organizationId: 1, ownerId: 1 });
  await accounts.createIndex(
    { organizationId: 1, customerId: 1 },
    { unique: true, partialFilterExpression: { customerId: { $type: 'string' } } },
  );
  await db.collection('crm_contacts').createIndex({ organizationId: 1, accountId: 1 });
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} organizationId
 * @param {Date} now
 */
async function migrateOrganization(db, organizationId, now) {
  const accounts = db.collection('crm_accounts');
  const contactsCol = db.collection('crm_contacts');
  const oppsCol = db.collection('crm_opportunities');
  const activitiesCol = db.collection('crm_activities');
  const report = {
    accountsCreated: { customer: 0, prospect: 0 },
    prospectsReused: 0,
    groups:
      /** @type {Array<{ accountId: string, name: string, spellings: Array<{ name: string, count: number }> }>} */ ([]),
    contactsWithoutCompany: 0,
    unknownMembers: /** @type {string[]} */ ([]),
    updated: { contacts: 0, opportunities: 0, activities: 0 },
  };

  const members = new Set(
    (
      await db
        .collection('memberships')
        .find({ organizationId }, { projection: { userId: 1 } })
        .toArray()
    ).map((m) => m.userId),
  );
  const unknown = new Set();
  /** @param {string | null | undefined} userId */
  const noteMember = (userId) => {
    if (typeof userId === 'string' && !members.has(userId)) unknown.add(userId);
  };

  // 1. Un compte client par fiche client.
  const customers = await db
    .collection('customers')
    .find({ organizationId }, { projection: { name: 1, active: 1 } })
    .toArray();
  for (const c of customers) {
    const customerId = String(c._id);
    const res = await accounts.updateOne(
      { organizationId, customerId },
      {
        $setOnInsert: {
          organizationId,
          kind: 'customer',
          customerId,
          name: c.name,
          sortName: normalizeName(c.name),
          searchKey: searchKeyOf([c.name]),
          ownerId: null,
          industry: null,
          origin: null,
          website: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
          active: c.active !== false,
          conversion: null,
          mergedInto: null,
          revision: 1,
          createdBy: SYSTEM_ACTOR,
          updatedBy: SYSTEM_ACTOR,
          createdAt: now,
          updatedAt: now,
          _schemaVersion: 1,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount === 1) report.accountsCreated.customer += 1;
  }
  /** @type {Map<string, { id: string, name: string }>} */
  const customerAccount = new Map();
  for (const a of await accounts
    .find(
      { organizationId, customerId: { $type: 'string' } },
      { projection: { customerId: 1, name: 1 } },
    )
    .toArray()) {
    customerAccount.set(a.customerId, { id: String(a._id), name: a.name });
  }

  // 2. Prospects regroupés par nom normalisé exact.
  const pendingContacts = await contactsCol
    .find({ organizationId, accountId: { $exists: false } })
    .toArray();
  const pendingOpps = await oppsCol
    .find({ organizationId, accountId: { $exists: false } })
    .toArray();
  const entries = [];
  for (const c of pendingContacts) {
    if (!c.customerId && nonEmpty(c.companyName)) {
      entries.push({
        name: c.companyName,
        createdAt: c.createdAt ?? now,
        createdBy: c.createdBy,
        source: 'contact',
      });
    }
  }
  for (const o of pendingOpps) {
    if (!o.customerId && nonEmpty(o.prospectName)) {
      entries.push({
        name: o.prospectName,
        createdAt: o.createdAt ?? now,
        createdBy: o.createdBy,
        source: 'opportunity',
      });
    }
  }
  /** @type {Map<string, { id: string, name: string }>} */
  const prospectAccount = new Map();
  for (const group of groupProspectNames(entries).values()) {
    const existing = await accounts.findOne(
      { organizationId, kind: 'prospect', mergedInto: null, sortName: group.key },
      { sort: { createdAt: 1, _id: 1 }, projection: { name: 1 } },
    );
    let account;
    if (existing) {
      account = { id: String(existing._id), name: existing.name };
      report.prospectsReused += 1;
    } else {
      noteMember(group.owner);
      const ownerId = group.owner && members.has(group.owner) ? group.owner : null;
      const res = await accounts.insertOne({
        organizationId,
        kind: 'prospect',
        customerId: null,
        name: group.name,
        sortName: group.key,
        searchKey: searchKeyOf([group.name]),
        ownerId,
        industry: null,
        origin: null,
        website: null,
        phone: null,
        email: null,
        address: null,
        notes: null,
        active: true,
        conversion: null,
        mergedInto: null,
        revision: 1,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
        createdAt: now,
        updatedAt: now,
        _schemaVersion: 1,
      });
      account = { id: String(res.insertedId), name: group.name };
      report.accountsCreated.prospect += 1;
    }
    prospectAccount.set(group.key, account);
    if (group.spellings.length > 1) {
      report.groups.push({ accountId: account.id, name: account.name, spellings: group.spellings });
    }
  }

  // 3. Contacts.
  const contactOps = [];
  /** @type {Map<string, string | null>} */
  const contactAccount = new Map();
  for (const c of pendingContacts) {
    let accountId = null;
    let customerId = c.customerId ?? null;
    let companyName = null;
    if (customerId) {
      const acc = customerAccount.get(customerId);
      accountId = acc ? acc.id : null;
    } else if (nonEmpty(c.companyName)) {
      const acc = prospectAccount.get(normalizeName(c.companyName));
      accountId = acc ? acc.id : null;
      companyName = acc ? acc.name : c.companyName.trim();
      customerId = null;
    }
    if (accountId === null) report.contactsWithoutCompany += 1;
    contactAccount.set(String(c._id), accountId);
    contactOps.push({
      updateOne: {
        filter: { _id: c._id, accountId: { $exists: false } },
        update: {
          $set: {
            accountId,
            customerId,
            companyName,
            searchKey: searchKeyOf([c.name, c.email, companyName, c.jobTitle]),
          },
          $max: { _schemaVersion: 2 },
        },
      },
    });
  }
  report.updated.contacts = await flush(contactsCol, contactOps);

  // 3 bis et 4. Opportunités.
  const oppOps = [];
  for (const o of pendingOpps) {
    let accountId = null;
    const set = {};
    if (o.customerId) {
      accountId = customerAccount.get(o.customerId)?.id ?? null;
    } else if (nonEmpty(o.prospectName)) {
      const acc = prospectAccount.get(normalizeName(o.prospectName));
      accountId = acc ? acc.id : null;
      if (acc) set.prospectName = acc.name;
    }
    set.accountId = accountId;
    if (o.ownerId === undefined) {
      set.ownerId = o.createdBy ?? null;
      noteMember(o.createdBy);
    }
    if (o.lostReasonKey === undefined) set.lostReasonKey = null;
    oppOps.push({
      updateOne: { filter: { _id: o._id, accountId: { $exists: false } }, update: { $set: set } },
    });
  }
  report.updated.opportunities = await flush(oppsCol, oppOps);

  // Compte de chaque opportunité et de chaque contact de l'organisation (migrés
  // ou non) : les activités en déduisent le leur.
  /** @type {Map<string, string | null>} */
  const oppAccount = new Map();
  for (const o of await oppsCol
    .find({ organizationId }, { projection: { accountId: 1 } })
    .toArray()) {
    oppAccount.set(String(o._id), o.accountId ?? null);
  }
  for (const c of await contactsCol
    .find({ organizationId }, { projection: { accountId: 1 } })
    .toArray()) {
    if (!contactAccount.has(String(c._id))) contactAccount.set(String(c._id), c.accountId ?? null);
  }

  // 3 ter et 4. Activités.
  const activityOps = [];
  for (const a of await activitiesCol
    .find({ organizationId, accountId: { $exists: false } })
    .toArray()) {
    const accountId =
      (a.opportunityId ? oppAccount.get(a.opportunityId) : null) ??
      (a.contactId ? contactAccount.get(a.contactId) : null) ??
      (a.customerId ? (customerAccount.get(a.customerId)?.id ?? null) : null) ??
      null;
    const set = { accountId };
    const due = a.dueAt instanceof Date ? a.dueAt : null;
    if (a.assigneeUserId === undefined) {
      set.assigneeUserId = due && a.done !== true ? (a.createdBy ?? null) : null;
      if (set.assigneeUserId) noteMember(set.assigneeUserId);
    }
    if (a.dueDay === undefined) set.dueDay = due ? kinshasaDayOf(due) : null;
    if (a.reminders === undefined) set.reminders = { dueSoonFor: null, overdueFor: null };
    activityOps.push({
      updateOne: { filter: { _id: a._id, accountId: { $exists: false } }, update: { $set: set } },
    });
  }
  report.updated.activities = await flush(activitiesCol, activityOps);

  report.unknownMembers = [...unknown].sort();
  return report;
}

/**
 * @param {import('mongodb').Db} db
 * @param {{ now?: Date, quiet?: boolean }} [options]
 * @returns {Promise<{ organizations: number, reports: number, accountsCreated: { customer: number, prospect: number } }>}
 */
export async function up(db, options = {}) {
  const now = options.now ?? new Date();
  const log = options.quiet ? () => {} : (/** @type {string} */ m) => console.log(`[${NAME}] ${m}`);
  await ensureIndexes(db);

  const orgs = new Set();
  for (const col of ['customers', 'crm_contacts', 'crm_opportunities', 'crm_activities']) {
    for (const id of await db.collection(col).distinct('organizationId')) {
      if (typeof id === 'string') orgs.add(id);
    }
  }
  const summary = { organizations: 0, reports: 0, accountsCreated: { customer: 0, prospect: 0 } };
  for (const organizationId of [...orgs].sort()) {
    const report = await migrateOrganization(db, organizationId, now);
    summary.organizations += 1;
    summary.accountsCreated.customer += report.accountsCreated.customer;
    summary.accountsCreated.prospect += report.accountsCreated.prospect;
    const touched =
      report.accountsCreated.customer +
      report.accountsCreated.prospect +
      report.updated.contacts +
      report.updated.opportunities +
      report.updated.activities;
    if (touched === 0) continue;
    await db
      .collection(REPORTS)
      .insertOne({ organizationId, migration: NAME, ranAt: now, ...report });
    summary.reports += 1;
    log(
      `${organizationId} : ${report.accountsCreated.customer} comptes client, ` +
        `${report.accountsCreated.prospect} prospects (${report.groups.length} groupes à graphies multiples), ` +
        `${report.contactsWithoutCompany} contacts sans entreprise, ` +
        `${report.unknownMembers.length} membres introuvables`,
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
 * `crm_accounts` et les champs ajoutés (compatibilité N-1) ; les retirer
 * effacerait aussi ce que l'application a écrit depuis (comptes saisis,
 * conversions, fusions). Seules la trace et les rapports sont retirés.
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  await db.collection(REPORTS).deleteMany({ migration: NAME });
  await db.collection('_migrations').deleteOne({ name: NAME });
}
