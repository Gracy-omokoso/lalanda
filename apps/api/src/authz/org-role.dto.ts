import { z } from 'zod';

import { normalizeOrgRole, type OrgRole } from './permissions.js';

/**
 * Rôle d'organisation accepté EN ENTRÉE d'API.
 *
 * Accepte les 8 slugs de docs/12 **et** l'ancienne valeur `member`, traduite en
 * `finance_director` par `normalizeOrgRole()`. C'est la compatibilité N-1 de
 * docs/24 règle 3 : pendant un déploiement progressif, un client web encore en
 * cache — ou une suite de tests écrite avant S20a — continue d'envoyer `member`,
 * et l'API ne doit pas le rejeter en 400.
 *
 * `owner` n'a pas besoin d'alias : le slug est identique avant et après S20a.
 *
 * La valeur STOCKÉE est toujours un slug S20a; l'alias ne survit jamais à
 * l'écriture (l'enum du schéma Mongoose ne l'accepterait pas).
 */
export const OrgRoleInput = z.string().transform((value, ctx): OrgRole => {
  const role = normalizeOrgRole(value);
  if (role === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Rôle d'organisation inconnu : « ${value} ».`,
    });
    return z.NEVER;
  }
  return role;
});
