// Migration du 3 nov. 2026 — pack de plan comptable SYSCOHADA révisé v2, au statut
// `approved`, par décision de la dirigeante (ADR-0049, amendement du 3 nov. 2026).
//
// ── Pourquoi une migration ────────────────────────────────────────────────────
//
// Le circuit de la plateforme (`POST /accounting/platform/chart-packs`, puis
// `…/transition`) charge un pack en `draft` et exige DEUX personnes de la plateforme
// pour le mener à `approved` (docs/09 § Administration). La dirigeante a tranché le
// 3 nov. 2026 : « fais ce qui s'applique en RDC Congo et nous allons améliorer au fur
// et à mesure avec les experts. Aucun client n'a encore commencé à utiliser Lalanda. »
// Cette migration enregistre donc le pack v2 directement au statut `approved`, avec la
// trace « décision de la dirigeante 2026-11-03 » dans son historique et dans le
// journal d'audit de la plateforme.
//
// ── Ce qu'elle fait ───────────────────────────────────────────────────────────
//
// 1. Lit le YAML livré avec le moteur (`@lalanda/engine/src/accounting/packs/
//    syscohada-revise-2017-cd-v2.yaml`) par `parseChartPack`, et vérifie que
//    `validateChartPack` ne signale AUCUN défaut au statut `approved` — la même
//    exigence que la transition de l'API. Empreinte : `chartPackFingerprint`, la même
//    que celle du chargement par l'API.
// 2. Pack absent : l'insère en `approved` (historique : chargé, mis en relecture,
//    approuvé — par l'acteur `system:decision-dirigeante-2026-11-03`).
// 3. Pack présent en `draft` ou `review`, même contenu : le passe à `approved`.
//    Contenu différent en `draft` : le remplace, puis l'approuve.
// 4. Pack présent en `approved` ou `active`, même empreinte : rien (idempotence).
//    Empreinte différente au-delà de `draft` : ÉCHEC — une version relue ne change
//    plus ; une correction est une version nouvelle.
// 5. Consigne l'exécution dans `_migrations` et une trace dans `audit_events`
//    (espace `platform`), une seule fois.
//
// Le moteur ne dépend d'aucun schéma Mongoose ; la migration utilise le driver brut
// (README). Elle exige le moteur compilé (`pnpm --filter @lalanda/engine build`), ce
// que l'image de production contient déjà.
//
// Les états restent des PROJETS (`draft_unverified`, bandeau « Projet — à valider par
// un expert-comptable ») : cette migration ne touche à aucune règle d'affichage.
//
// Compatibilité N-1 (README, règle 3) : l'ancienne API lit le pack v2 sans le champ
// `suspenseAccount` (ignoré) et garde le compte technique `ATTENTE`.
//
// Exécution :
//   node --env-file=.env.production apps/api/migrations/run.mjs 20261103-0001-pack-syscohada-v2-approuve

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { chartPackFingerprint, parseChartPack, validateChartPack } from '@lalanda/engine';

const NAME = '20261103-0001-pack-syscohada-v2-approuve';
const PACKS = 'accounting_chart_packs';
export const PACK_REF = Object.freeze({ slug: 'syscohada-revise-2017-cd', version: 2 });
/** Auteur des transitions : la décision, pas une personne de la plateforme. */
export const DECISION_ACTOR = 'system:decision-dirigeante-2026-11-03';
export const DECISION_TRACE = 'décision de la dirigeante 2026-11-03';

/** Contenu lu et validé du pack v2 livré avec le moteur. */
export function readPackV2() {
  const exiger = createRequire(import.meta.url);
  const engineRoot = dirname(exiger.resolve('@lalanda/engine/package.json'));
  const path = resolve(
    engineRoot,
    'src',
    'accounting',
    'packs',
    `${PACK_REF.slug}-v${PACK_REF.version}.yaml`,
  );
  const content = parseChartPack(readFileSync(path, 'utf8'));
  if (content.slug !== PACK_REF.slug || content.version !== PACK_REF.version) {
    throw new Error(`Le fichier déclare ${content.slug}@${content.version}, pas le pack v2.`);
  }
  const issues = validateChartPack({ ...content, status: 'approved' });
  if (issues.length > 0) {
    throw new Error(
      `Pack v2 non approuvable :\n${issues.map((i) => `  - ${i.code} ${i.path}`).join('\n')}`,
    );
  }
  return content;
}

/** @param {string} from @param {string} to @param {Date} at */
function step(action, from, to, at) {
  return { action, from, to, by: DECISION_ACTOR, at, note: DECISION_TRACE };
}

/** @param {import('mongodb').Db} db */
export async function up(db) {
  const content = readPackV2();
  const fingerprint = chartPackFingerprint(content);
  const packs = db.collection(PACKS);
  const now = new Date();
  const existing = await packs.findOne({ slug: PACK_REF.slug, version: PACK_REF.version });
  let outcome;

  if (existing === null) {
    await packs.insertOne({
      slug: PACK_REF.slug,
      version: PACK_REF.version,
      status: 'approved',
      content,
      fingerprint,
      loadedBy: DECISION_ACTOR,
      history: [
        step('loaded', null, 'draft', now),
        step('transition', 'draft', 'review', now),
        step('transition', 'review', 'approved', now),
      ],
      decision: { by: 'Gracy Omokoso', on: '2026-11-03', note: DECISION_TRACE },
      revision: 1,
      _schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    outcome = 'inserted';
  } else if (existing.status === 'approved' || existing.status === 'active') {
    if (existing.fingerprint !== fingerprint) {
      throw new Error(
        `Le pack ${PACK_REF.slug}@${PACK_REF.version} est « ${existing.status} » avec un autre contenu : une version relue ne change plus.`,
      );
    }
    outcome = 'unchanged';
  } else if (existing.status === 'draft' || existing.status === 'review') {
    if (existing.fingerprint !== fingerprint && existing.status !== 'draft') {
      throw new Error(
        `Le pack ${PACK_REF.slug}@${PACK_REF.version} est en relecture avec un autre contenu : rendez-le au brouillon d'abord.`,
      );
    }
    const steps = [
      ...(existing.fingerprint !== fingerprint ? [step('reloaded', 'draft', 'draft', now)] : []),
      ...(existing.status === 'draft' ? [step('transition', 'draft', 'review', now)] : []),
      step('transition', 'review', 'approved', now),
    ];
    const res = await packs.updateOne(
      { _id: existing._id, revision: existing.revision, status: existing.status },
      {
        $set: {
          status: 'approved',
          content,
          fingerprint,
          decision: { by: 'Gracy Omokoso', on: '2026-11-03', note: DECISION_TRACE },
          updatedAt: now,
        },
        $push: { history: { $each: steps } },
        $inc: { revision: 1 },
      },
    );
    if (res.modifiedCount !== 1) {
      throw new Error('Le pack a changé pendant la migration : relancez-la.');
    }
    outcome = 'approved';
  } else {
    throw new Error(
      `Le pack ${PACK_REF.slug}@${PACK_REF.version} est « ${existing.status} » : rien n'est fait.`,
    );
  }

  if (outcome !== 'unchanged') {
    await db.collection('audit_events').insertOne({
      organizationId: 'platform',
      actorUserId: DECISION_ACTOR,
      actorRole: 'decision_dirigeante',
      action: 'accounting.chart_pack.transition',
      targetType: 'accounting_chart_pack',
      targetId: `${PACK_REF.slug}@${PACK_REF.version}`,
      metadata: {
        slug: PACK_REF.slug,
        version: PACK_REF.version,
        to: 'approved',
        fingerprint,
        via: NAME,
        decision: DECISION_TRACE,
      },
      _schemaVersion: 1,
      createdAt: now,
    });
    await db
      .collection('_migrations')
      .updateOne(
        { name: NAME },
        { $setOnInsert: { name: NAME, appliedAt: now }, $set: { outcome, fingerprint } },
        { upsert: true },
      );
  }
  console.log(`[${NAME}] ${PACK_REF.slug}@${PACK_REF.version} : ${outcome} (${fingerprint})`);
  return { outcome, fingerprint };
}

/**
 * Meilleur effort : retire le pack v2 s'il est encore `approved`, posé par cette
 * migration et choisi par AUCUNE organisation. Sinon, refuse : une organisation qui
 * l'a choisi (a fortiori qui l'a activé) le garde.
 * @param {import('mongodb').Db} db
 */
export async function down(db) {
  const packs = db.collection(PACKS);
  const existing = await packs.findOne({ slug: PACK_REF.slug, version: PACK_REF.version });
  if (existing === null) return { outcome: 'absent' };
  const used = await db
    .collection('accounting_settings')
    .countDocuments({ 'chartPack.slug': PACK_REF.slug, 'chartPack.version': PACK_REF.version });
  if (used > 0 || existing.status !== 'approved' || existing.loadedBy !== DECISION_ACTOR) {
    throw new Error(
      `Retour arrière refusé : pack « ${existing.status} », choisi par ${used} organisation(s).`,
    );
  }
  await packs.deleteOne({ _id: existing._id });
  await db.collection('_migrations').deleteOne({ name: NAME });
  return { outcome: 'removed' };
}
