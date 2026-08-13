// DTO de l'appel vocal avec Lala.
//
// ╔══════════════════════════════════════════════════════════════════════════╗
// ║ LA REQUÊTE D'OUVERTURE N'A PAS DE CHAMPS. CE N'EST PAS UN OUBLI.         ║
// ║                                                                          ║
// ║ L'agent vocal répond à des questions de NOTION (« qu'est-ce qu'un        ║
// ║ DSCR ? ») à partir de ce que l'utilisateur lui DIT de vive voix. Il ne   ║
// ║ reçoit jamais les chiffres du projet — voir l'encadré de                ║
// ║ `lala-vocal-prompt.ts` : en temps réel, le garde-fou numérique de        ║
// ║ `lala-nombres.ts` est inapplicable, la parole partant avant qu'on puisse ║
// ║ la relire.                                                               ║
// ║                                                                          ║
// ║ Un schéma STRICT et VIDE est ce qui rend la frontière vérifiable plutôt  ║
// ║ qu'affirmée : il n'y a pas de champ à remplir, et un champ ajouté ici    ║
// ║ demain fait échouer `lala-vocal-frontiere.test.ts`. Contrairement au     ║
// ║ chat écrit (`ChatRequestSchema`), ni `lines`, ni `sheetId`, ni           ║
// ║ `templateSlug`, ni `devise` n'ont leur place ici.                        ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { z } from 'zod';

import { PLANS } from '@lalanda/shared/pricing';

/**
 * Corps accepté par `POST /ai/lala/vocal/sessions` : AUCUN champ.
 *
 * `.strict()` et non `.passthrough()` : un client qui joindrait quand même des
 * chiffres reçoit un 400 explicite au lieu de les voir ignorés en silence. Un
 * refus bruyant est ce qui fait remonter la tentative.
 */
export const SessionVocaleRequestSchema = z.object({}).strict();
export type SessionVocaleRequest = z.infer<typeof SessionVocaleRequestSchema>;

/** Ce que l'interface a besoin de savoir du quota pendant l'appel. */
export const QuotaVocalViewSchema = z.object({
  plan: z.enum(PLANS),
  /** `null` = illimité (offre négociée au contrat). */
  limiteMinutes: z.number().int().nonnegative().nullable(),
  minutesConsommees: z.number().nonnegative(),
  minutesRestantes: z.number().nonnegative().nullable(),
  reinitialisationLe: z.string().datetime(),
});
export type QuotaVocalView = z.infer<typeof QuotaVocalViewSchema>;

export const SessionVocaleResponseSchema = z.object({
  /**
   * URL signée par ElevenLabs, à passer telle quelle à `startSession`.
   *
   * Produite par l'API à partir de la clé lue dans le coffre : la clé
   * ElevenLabs n'atteint JAMAIS le navigateur. L'URL, elle, est un jeton de
   * session à durée de vie courte — elle ne se journalise pas et ne se met pas
   * en cache.
   */
  signedUrl: z.string().url(),
  /** Identifiant de la session côté Lalanda, à rendre à la clôture. */
  sessionId: z.string().min(1),
  /**
   * Plafond de durée de CETTE session, en secondes.
   *
   * En secondes et non en minutes : c'est un compte à rebours d'interface, et
   * une minuterie qui n'a que des minutes ne peut pas afficher « 0:47 ».
   */
  dureeMaxSecondes: z.number().int().positive(),
  /** Mention affichée pendant tout l'appel — voir `MENTION_VOCALE`. */
  mention: z.string().min(1),
  quota: QuotaVocalViewSchema,
});
export type SessionVocaleResponse = z.infer<typeof SessionVocaleResponseSchema>;

/**
 * Fin de session rapportée par le client.
 *
 * `minutes` est une DURÉE, pas un contenu : c'est le seul chiffre qui remonte
 * d'une conversation vocale, et il ne dit rien de ce qui s'y est dit.
 *
 * Une durée rapportée n'est jamais crue sur parole à la hausse : elle est bornée
 * au plafond de session côté serveur (`minutesADebiter`), et son absence coûte
 * le plafond. Rapporter est donc toujours dans l'intérêt de l'utilisateur, et
 * ne pas rapporter n'est jamais avantageux.
 */
export const ClotureVocaleRequestSchema = z
  .object({
    sessionId: z.string().min(1).max(128),
    minutes: z
      .number()
      .nonnegative()
      .max(24 * 60),
  })
  .strict();
export type ClotureVocaleRequest = z.infer<typeof ClotureVocaleRequestSchema>;

export const ClotureVocaleResponseSchema = z.object({
  quota: QuotaVocalViewSchema,
});
export type ClotureVocaleResponse = z.infer<typeof ClotureVocaleResponseSchema>;

/** État du quota, sans ouvrir de session — l'interface s'en sert pour le bouton. */
export const EtatVocalResponseSchema = z.object({
  /** L'appel vocal est-il utilisable ici et maintenant ? */
  disponible: z.boolean(),
  /**
   * Pourquoi il ne l'est pas, quand il ne l'est pas.
   *
   * `non_configure` ne se distingue pas de `quota_epuise` par politesse : un
   * utilisateur qui a épuisé ses minutes doit lire « elles reviennent le 1er »,
   * et un utilisateur d'un déploiement sans clé doit lire « la voix n'est pas
   * activée ici ». Les deux mènent au même bouton grisé mais pas au même geste.
   */
  motif: z.enum(['non_configure', 'quota_epuise', 'offre_sans_voix']).nullable(),
  message: z.string().nullable(),
  quota: QuotaVocalViewSchema.nullable(),
});
export type EtatVocalResponse = z.infer<typeof EtatVocalResponseSchema>;
