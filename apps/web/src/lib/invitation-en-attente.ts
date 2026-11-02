// Invitation suivie à travers la connexion ou l'inscription (ADR-0052 — O5, § 6).
//
// Le lien d'invitation mène à `/invitations/accept?token=…`. Sans session, le middleware
// renvoie vers `/login` en repartant d'une requête vide (S22e) : le jeton était perdu, et
// une personne qui s'inscrivait pour rejoindre une organisation atterrissait dans son
// organisation personnelle vide. Le middleware garde donc le jeton dans un cookie court,
// limité à ce seul usage ; une fois la session ouverte, la bannière des invitations le
// reprend et renvoie vers la page d'acceptation, qui bascule vers l'organisation invitante.
//
// Le jeton n'ouvre rien à lui seul : l'API n'accepte qu'au compte dont l'adresse est
// celle de l'invitation (`INVITATION_EMAIL_MISMATCH`), comme quand il est dans l'URL.

export const COOKIE_INVITATION = 'lalanda_invitation';

/** Durée de vie d'une invitation côté API (7 jours) : le cookie ne lui survit pas. */
export const DUREE_COOKIE_INVITATION_S = 60 * 60 * 24 * 7;

/** Format du jeton émis par l'API (`randomBytes(32).toString('hex')`). */
export function jetonInvitationValide(jeton: string | null | undefined): jeton is string {
  return typeof jeton === 'string' && /^[0-9a-f]{64}$/.test(jeton);
}

/** Page d'acceptation pour un jeton valide. */
export function cheminAcceptation(jeton: string): string {
  return `/invitations/accept?token=${encodeURIComponent(jeton)}`;
}

/** Lit le jeton suivi dans une chaîne `document.cookie`. */
export function lireJetonInvitation(cookies: string): string | null {
  for (const part of cookies.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_INVITATION) {
      let v: string;
      try {
        v = decodeURIComponent(rest.join('='));
      } catch {
        return null;
      }
      return jetonInvitationValide(v) ? v : null;
    }
  }
  return null;
}

/** Chaîne qui efface le cookie suivi (à affecter à `document.cookie`). */
export function effacementCookieInvitation(): string {
  return `${COOKIE_INVITATION}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** Texte de la page d'inscription quand une invitation est suivie. */
export const TEXTE_INSCRIPTION_INVITEE =
  'Une fois votre compte créé, vous arriverez dans l’espace de l’organisation qui vous invite.';

/** Refus de `POST /invitations/accept`, en français simple. */
const MESSAGES_REFUS: Record<string, string> = {
  INVITATION_NOT_FOUND: 'Cette invitation n’existe pas ou n’est plus valable.',
  INVITATION_REVOKED: 'Cette invitation a été annulée par l’organisation.',
  INVITATION_EXPIRED: 'Cette invitation a expiré. Demandez-en une nouvelle.',
  INVITATION_EMAIL_MISMATCH:
    'Cette invitation a été envoyée à une autre adresse. Connectez-vous avec l’adresse invitée.',
};

export function messageRefusInvitation(err: unknown): string {
  const detail = (err as { detail?: unknown } | null)?.detail;
  const code =
    typeof detail === 'object' && detail !== null && 'code' in detail
      ? String((detail as { code: unknown }).code)
      : '';
  return MESSAGES_REFUS[code] ?? 'Impossible d’accepter l’invitation. Réessayez plus tard.';
}
