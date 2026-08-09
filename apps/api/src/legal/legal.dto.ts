// DTO du module légal (S22c).
//
// Une seule entrée utilisateur existe : la version acceptée. Elle est validée
// deux fois — sur la FORME (zod, `.strict()`) puis sur le FOND (la version
// a-t-elle réellement été publiée ?). La seconde vérification est la seule qui
// compte vraiment : une chaîne bien formée mais inventée passerait la première.

import { isKnownLegalVersion } from '@lalanda/shared/legal';
import { z } from 'zod';

/**
 * Corps de `POST /legal/terms/acceptance`.
 *
 * `.strict()` : tout champ supplémentaire est refusé en 400. En particulier un
 * `userId` glissé dans le corps — le propriétaire de l'acceptation est TOUJOURS
 * lu dans la session, jamais dans la requête. Le schéma strict transforme la
 * tentative en erreur plutôt qu'en champ ignoré en silence.
 *
 * `refine` sur `isKnownLegalVersion` : refuse une version jamais publiée. Sans
 * cela, `{"version":"2099-01-01"}` enregistrerait une acceptation que toute
 * comparaison à la version courante donnerait pour périmée… ou, selon le sens de
 * la comparaison, pour éternellement à jour. Une preuve ne peut porter que sur
 * un texte qui a existé.
 */
export const AcceptTermsSchema = z
  .object({
    version: z
      .string()
      .min(1)
      .refine(isKnownLegalVersion, {
        message: 'Version du corpus légal inconnue',
      }),
  })
  .strict();

export type AcceptTermsInput = z.infer<typeof AcceptTermsSchema>;

/** Réponse de lecture : état de l'accord de l'utilisateur courant. */
export interface TermsAcceptanceView {
  /** Version en vigueur, celle qu'il faut accepter. */
  currentVersion: string;
  /** Dernière version acceptée par l'utilisateur, `null` s'il n'a jamais accepté. */
  acceptedVersion: string | null;
  /** Date de cette acceptation, `null` si aucune. */
  acceptedAt: string | null;
  /**
   * L'accord couvre-t-il le corpus en vigueur ?
   *
   * `false` aussi bien pour « jamais accepté » que pour « accepté une version
   * antérieure » : les deux appellent le même traitement, redemander l'accord.
   * Les distinguer inviterait à traiter une acceptation périmée comme
   * suffisante — c'est-à-dire à opposer à l'utilisateur un texte qu'il n'a pas lu.
   */
  isCurrent: boolean;
}
