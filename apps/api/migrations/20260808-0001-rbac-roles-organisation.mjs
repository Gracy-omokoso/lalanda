// Migration S20a — RBAC : rôles d'organisation `owner`/`member` → les 8 rôles
// de docs/12-ROLES-PERMISSIONS.md.
//
// ── Correspondance ────────────────────────────────────────────────────────────
//
//   owner  → proprietaire   (même portée : abonnement, membres, transfert)
//   member → chef_projet    (voir justification ci-dessous)
//
// **Pourquoi `chef_projet` et pas `lecteur` ?** Avant S20a, un `member` pouvait
// créer un projet, en modifier les hypothèses, éditer le canvas, saisir le réalisé
// et exporter. Rétrograder ces comptes en `lecteur` casserait des usages en cours
// sans avertissement. `chef_projet` (docs/12 : « projets autorisés et saisie ») est
// le rôle LE MOINS PRIVILÉGIÉ qui conserve ces usages : il n'apporte ni validation
// de plan (`plan.approve`), ni clôture (`period.close`), ni gestion des membres —
// trois pouvoirs que les anciens `member` n'avaient déjà pas (la réouverture et les
// invitations étaient déjà réservées aux owners). La migration ne donne donc aucun
// droit nouveau à personne : c'est une traduction, pas une élévation.
//
// Idempotence : les filtres portent sur les ANCIENNES valeurs. Rejouée, la
// migration ne trouve plus rien et n'écrit rien.
//
// Compatibilité N-1 (docs/24, règle 3) : l'API S20a lit encore `owner`/`member`
// via `normalizeOrgRole()`; la migration peut donc être jouée avant OU après le
// déploiement sans fenêtre de refus.
//
// Exécution manuelle en attendant le runner :
//   node --env-file=.env.production apps/api/migrations/20260808-0001-rbac-roles-organisation.mjs

const NAME = '20260808-0001-rbac-roles-organisation';

/** owner → proprietaire, member → chef_projet. */
const UP_MAPPING = [
  { from: 'owner', to: 'proprietaire' },
  { from: 'member', to: 'chef_projet' },
];

/** @param {import('mongodb').Db} db */
export async function up(db) {
  for (const collection of ['memberships', 'invitations']) {
    for (const { from, to } of UP_MAPPING) {
      const res = await db
        .collection(collection)
        .updateMany({ role: from }, { $set: { role: to, _schemaVersion: 2 } });
      // eslint-disable-next-line no-console
      console.log(`[${NAME}] ${collection}: ${from} → ${to} — ${res.modifiedCount} document(s)`);
    }
  }

  // Les documents déjà porteurs d'un rôle S20a mais restés en _schemaVersion 1
  // (créés par une instance API déployée avant le passage de la migration).
  const alignes = await db
    .collection('memberships')
    .updateMany(
      { _schemaVersion: { $lt: 2 }, role: { $nin: ['owner', 'member'] } },
      { $set: { _schemaVersion: 2 } },
    );
  // eslint-disable-next-line no-console
  console.log(`[${NAME}] memberships: ${alignes.modifiedCount} _schemaVersion alignée(s)`);

  // Index de lecture du journal d'audit introduit par le même lot (idempotent).
  await db.collection('audit_events').createIndex({ organizationId: 1, createdAt: -1 });
  await db
    .collection('platform_role_assignments')
    .createIndex({ userId: 1, role: 1 }, { unique: true });

  await db
    .collection('_migrations')
    .updateOne({ name: NAME }, { $set: { name: NAME, appliedAt: new Date() } }, { upsert: true });
}

/**
 * Retour arrière : `proprietaire` → `owner`, et TOUS les autres rôles → `member`.
 *
 * IRRÉVERSIBLE EN INFORMATION : l'ancien modèle n'a que deux valeurs, un
 * `comptable` et un `lecteur` redeviennent indistinctement `member`. Le `down` sert
 * à restaurer un service, pas une granularité — refaire un `up` après un `down`
 * remettra tout le monde en `chef_projet`. Sauvegarde préalable obligatoire
 * (règle 1 du README des migrations).
 *
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  for (const collection of ['memberships', 'invitations']) {
    await db
      .collection(collection)
      .updateMany({ role: 'proprietaire' }, { $set: { role: 'owner', _schemaVersion: 1 } });
    await db
      .collection(collection)
      .updateMany(
        { role: { $nin: ['owner', 'proprietaire'] } },
        { $set: { role: 'member', _schemaVersion: 1 } },
      );
  }
  await db.collection('_migrations').deleteOne({ name: NAME });
}
