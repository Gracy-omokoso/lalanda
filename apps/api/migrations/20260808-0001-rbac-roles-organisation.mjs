// Migration S20a — RBAC : rôles d'organisation `owner | member` → les 8 rôles de
// docs/12-ROLES-PERMISSIONS.md (ADR-0012 §7).
//
// ── Correspondance ────────────────────────────────────────────────────────────
//
//   member → finance_director
//   owner  → owner              (le slug n'a pas changé : rien à réécrire)
//
// **Pourquoi `finance_director` ?** Par ISO-PRIVILÈGE. Avant S20a, un `member`
// pouvait, dans le code livré, créer et modifier des projets, saisir des
// hypothèses, calculer, valider un plan (S16c), importer du réalisé, clôturer une
// période et exporter — tout sauf gérer l'organisation, l'abonnement et les
// invitations, réservés à `owner`. C'est exactement la ligne `finance_director` de
// la matrice. La migration ne retire ni n'ajoute aucun droit à personne.
//
// Alternatives rejetées (ADR-0012 §7) :
//   - `viewer` (moindre privilège) : régression silencieuse pour tous les comptes
//     bêta, qui perdraient du jour au lendemain l'usage de leurs propres projets.
//     Un durcissement ne se fait pas par surprise sur des données vivantes.
//   - `admin` : détient `members.invite` et `organization.manage` qu'un `member`
//     n'avait pas → ÉLÉVATION DE PRIVILÈGE par migration, la menace que docs/17
//     place en priorité.
//
// ── Idempotence ───────────────────────────────────────────────────────────────
//
// Tous les filtres portent sur `_schemaVersion: 1`. Une fois les documents passés
// en v2, une seconde exécution ne les sélectionne plus et n'écrit rien. L'ORDRE
// des deux premières étapes importe : convertir les rôles AVANT de basculer les
// `owner` en v2, sinon l'étape 2 ferait passer les `member` en v2 et l'étape 1 ne
// les trouverait plus.
//
// Pas de transaction globale : le volume peut dépasser les limites de transaction
// MongoDB. Des `updateMany` filtrés et rejouables sont plus sûrs ici (ADR-0012 §7).
//
// Compatibilité N-1 (docs/24, règle 3) : l'API S20a lit encore `member` via
// `normalizeOrgRole()`; la migration peut donc être jouée avant OU après le
// déploiement, sans fenêtre de refus.
//
// Exécution manuelle en attendant le runner :
//   node --env-file=.env.production apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs

const NAME = '20260808-0001-rbac-roles-organisation';

/** Collections portant un rôle d'organisation. */
const ROLE_COLLECTIONS = ['memberships', 'invitations'];

/** @param {import('mongodb').Db} db */
export async function up(db) {
  for (const collection of ROLE_COLLECTIONS) {
    // 1. `member` → `finance_director`, et passage en v2 dans la même écriture.
    const convertis = await db
      .collection(collection)
      .updateMany(
        { _schemaVersion: 1, role: 'member' },
        { $set: { role: 'finance_director', _schemaVersion: 2 } },
      );

    // 2. `owner` : le slug est inchangé, seule la version de schéma bouge.
    const owners = await db
      .collection(collection)
      .updateMany({ _schemaVersion: 1, role: 'owner' }, { $set: { _schemaVersion: 2 } });

    // eslint-disable-next-line no-console
    console.log(
      `[${NAME}] ${collection}: ${convertis.modifiedCount} member→finance_director, ` +
        `${owners.modifiedCount} owner alignés en v2`,
    );
  }

  // 3. Droit conditionnel `canClosePeriods` (case ⚙ de la matrice) : absent des
  //    documents v1, il doit exister et valoir `false` — refus par défaut. Le
  //    filtre `$exists: false` rend l'étape naturellement idempotente.
  const drapeaux = await db
    .collection('memberships')
    .updateMany({ canClosePeriods: { $exists: false } }, { $set: { canClosePeriods: false } });
  // eslint-disable-next-line no-console
  console.log(`[${NAME}] memberships: ${drapeaux.modifiedCount} canClosePeriods initialisés`);

  // 4. Index introduits par le même lot. `createIndex` est idempotent.
  await db.collection('memberships').createIndex({ organizationId: 1, role: 1 });
  await db.collection('audit_events').createIndex({ organizationId: 1, createdAt: -1 });
  await db.collection('audit_events').createIndex({ organizationId: 1, action: 1, createdAt: -1 });
  await db.collection('platform_roles').createIndex({ userId: 1, role: 1 }, { unique: true });

  await db
    .collection('_migrations')
    .updateOne({ name: NAME }, { $set: { name: NAME, appliedAt: new Date() } }, { upsert: true });
}

/**
 * Retour arrière : `owner` reste `owner`, TOUS les autres rôles → `member`.
 *
 * IRRÉVERSIBLE EN INFORMATION : l'ancien modèle n'a que deux valeurs; un
 * `accountant` et un `viewer` redeviennent indistinctement `member`, ce qui
 * ÉLARGIT leurs droits sous l'ancien code. Le `down` sert à restaurer un service,
 * pas une granularité — et il n'est sûr qu'immédiatement après un `up` raté, avant
 * que de nouveaux rôles fins aient été attribués. Sauvegarde préalable obligatoire
 * (règle 1 du README des migrations).
 *
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  for (const collection of ROLE_COLLECTIONS) {
    await db
      .collection(collection)
      .updateMany({ _schemaVersion: 2, role: 'owner' }, { $set: { _schemaVersion: 1 } });
    await db
      .collection(collection)
      .updateMany(
        { _schemaVersion: 2, role: { $ne: 'owner' } },
        { $set: { role: 'member', _schemaVersion: 1 } },
      );
  }
  await db.collection('memberships').updateMany({}, { $unset: { canClosePeriods: '' } });
  await db.collection('_migrations').deleteOne({ name: NAME });
}
