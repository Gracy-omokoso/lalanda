// Migration S22j — amorçage du PREMIER `platform_super_admin`.
//
// ── Le problème qu'elle résout ────────────────────────────────────────────────
//
// L'espace `/admin` existe (S21b) et est gardé par `@RequirePlatformRole`. Mais
// aucune route ne crée d'attribution de rôle plateforme — c'est écrit noir sur
// blanc dans `authz/platform-role-assignment.schema.ts` : « les rôles plateforme
// sont posés à la main (ou par migration) ». Sur une base neuve, `platform_roles`
// est donc vide et PERSONNE ne peut ouvrir `/admin`, y compris pour y attribuer
// des rôles. Poule et œuf : il faut un premier super admin posé hors du produit.
//
// C'est exactement ce que fait cette migration, et rien d'autre.
//
// ── Pourquoi par email et pas par identifiant ─────────────────────────────────
//
// Un `_id` codé en dur ne vaut que pour une base. En le résolvant depuis
// `PLATFORM_BOOTSTRAP_EMAIL`, la même migration sert en développement et sur le
// serveur de production, où l'identifiant du décideur n'est pas connu d'avance.
//
// ── Ce qu'elle refuse de faire ────────────────────────────────────────────────
//
// 1. **Elle ne ressuscite jamais une attribution révoquée.** Une révocation est
//    une décision de sécurité; une migration rejouée qui la annulerait en silence
//    rendrait l'accès le plus élevé du produit à quelqu'un à qui on l'a retiré.
//    Ce cas échoue bruyamment plutôt que d'écrire.
// 2. **Elle ne crée aucun compte.** L'utilisateur doit déjà exister — il s'est
//    inscrit normalement. Sinon la migration échoue en le disant.
// 3. **Elle n'attribue qu'à UN utilisateur**, celui de la variable. Pas de liste,
//    pas de « tous les comptes du domaine ».
//
// ── Idempotence ───────────────────────────────────────────────────────────────
//
// L'attribution est cherchée sur `{userId, role}` — la clé de l'index unique posé
// par la migration 20260808-0001. Si elle existe et n'est pas révoquée, la
// migration ne réécrit rien. Une seconde exécution est donc sans effet.
//
// ── Compatibilité N-1 (docs/24, règle 3) ──────────────────────────────────────
//
// Purement additive : elle insère un document dans une collection que l'API lit
// déjà. Aucune version antérieure n'est gênée. Jouable avant ou après le
// déploiement.
//
// Exécution :
//   PLATFORM_BOOTSTRAP_EMAIL=… node --env-file=.env \
//     apps/api/migrations/run.mjs 20260810-0001-amorcage-premier-super-admin

const NAME = '20260810-0001-amorcage-premier-super-admin';
const ROLE = 'platform_super_admin';

/**
 * Marqueur du `reason` : il identifie les attributions posées par CETTE
 * migration, pour que `down` ne retire jamais un rôle accordé légitimement
 * ailleurs (par un autre super admin, par exemple).
 */
const RAISON = 'Amorçage du premier super admin (migration ' + NAME + ')';

/** @param {import('mongodb').Db} db */
export async function up(db) {
  const email = process.env['PLATFORM_BOOTSTRAP_EMAIL']?.trim();

  if (!email) {
    // Pas une erreur : sur un déploiement où l'amorçage est déjà fait, la
    // variable n'est plus posée et la migration doit passer sans rien faire.
    console.log(
      `[${NAME}] PLATFORM_BOOTSTRAP_EMAIL absent — aucun amorçage demandé, rien à faire.`,
    );
    return;
  }

  const user = await db.collection('user').findOne({ email }, { projection: { _id: 1 } });
  if (!user) {
    throw new Error(
      `[${NAME}] Aucun utilisateur avec l'email « ${email} ». ` +
        `Le compte doit exister (inscription normale) AVANT l'amorçage : ` +
        `cette migration n'en crée pas.`,
    );
  }

  const userId = String(user._id);
  const existante = await db.collection('platform_roles').findOne({ userId, role: ROLE });

  if (existante) {
    if (existante.revokedAt) {
      throw new Error(
        `[${NAME}] L'attribution ${ROLE} de « ${email} » a été RÉVOQUÉE le ` +
          `${existante.revokedAt.toISOString()}. Une migration ne lève pas une ` +
          `révocation : si l'accès doit être rendu, c'est une décision à prendre ` +
          `explicitement, pas un effet de bord d'un rejeu.`,
      );
    }
    console.log(`[${NAME}] « ${email} » est déjà ${ROLE} — rien à faire.`);
    return;
  }

  const maintenant = new Date();
  await db.collection('platform_roles').insertOne({
    userId,
    role: ROLE,
    // `null` = amorçage manuel / migration, par convention du schéma : personne
    // n'a pu accorder ce rôle, puisqu'il est le premier.
    grantedBy: null,
    reason: RAISON,
    // Permanent : un amorçage qui expire fermerait `/admin` sans prévenir.
    expiresAt: null,
    revokedAt: null,
    _schemaVersion: 1,
    createdAt: maintenant,
    updatedAt: maintenant,
  });

  console.log(`[${NAME}] ${ROLE} accordé à « ${email} » (userId=${userId}).`);

  await db
    .collection('_migrations')
    .updateOne({ name: NAME }, { $set: { name: NAME, appliedAt: maintenant } }, { upsert: true });
}

/**
 * Retour arrière : retire UNIQUEMENT l'attribution posée par cette migration,
 * reconnue à son `reason`. Une attribution `platform_super_admin` accordée
 * autrement (par un autre administrateur, avec un autre motif) n'est pas touchée
 * — sans quoi un `down` pourrait fermer la plateforme à tout le monde.
 *
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  const res = await db.collection('platform_roles').deleteMany({ role: ROLE, reason: RAISON });
  console.log(`[${NAME}] down : ${res.deletedCount} attribution(s) d'amorçage retirée(s).`);
  await db.collection('_migrations').deleteOne({ name: NAME });
}
