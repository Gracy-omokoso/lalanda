// ─────────────────────────────────────────────────────────────────────────────
// FOURNISSEUR MANUEL (S22b) — mobile money et virement, confirmés par un humain
//
// C'est le seul fournisseur de ce lot qui fonctionne AUJOURD'HUI, sans compte
// marchand, sans clé, sans contrat. Il est aussi le plus important
// commercialement : en RDC, le mobile money est le moyen de paiement dominant,
// et la page /pricing le promet déjà.
//
// ── Pourquoi manuel plutôt qu'un agrégateur ──────────────────────────────────
//
// Les agrégateurs mobile money (pawaPay, Flutterwave, MaxiCash) exigent tous un
// compte marchand vérifié pour obtenir des identifiants, ET — c'est le point
// bloquant — pour connaître le schéma exact de signature de leurs rappels, qui
// n'est pas publiquement vérifiable de bout en bout. Un fournisseur écrit sur
// des suppositions passerait des tests écrits contre ces mêmes suppositions :
// une intégration qui a l'air verte et qui accepte n'importe quel rappel.
//
// Le fournisseur manuel n'a pas ce problème parce qu'il ne prétend rien : le
// client reçoit des instructions de dépôt, il paie, un administrateur
// plateforme constate la réception et confirme. La confirmation passe par la
// MÊME machine d'état et le MÊME journal d'audit que Stripe — le jour où un
// agrégateur est branché, seule la source de l'événement change.
//
// ── Ce que ce fournisseur ne fait pas, volontairement ────────────────────────
//
// Aucun renouvellement automatique. Un dépôt mobile money est un paiement
// ponctuel : il n'existe pas de mandat de prélèvement. L'abonnement souscrit
// ainsi arrive à échéance et repasse par `past_due` comme les autres — c'est
// exact, pas dégradé, et l'interface doit le dire (« paiement à renouveler
// manuellement »). Prétendre le contraire produirait des suspensions surprises.
// ─────────────────────────────────────────────────────────────────────────────

import {
  WebhookSignatureError,
  type CheckoutRequest,
  type CheckoutResult,
  type NormalizedWebhookEvent,
  type PaymentInstructions,
  type PaymentMethod,
  type PaymentProvider,
  type ProviderAvailability,
  type WebhookRequest,
} from './payment-provider.js';
import type { PaymentSecretsResolver } from './payment-secrets.js';

/** Délai annoncé au client avant confirmation d'un dépôt, en heures. */
export const MANUAL_CONFIRMATION_DELAY_HOURS = 24;

/**
 * Coordonnées de dépôt par défaut.
 *
 * Vides — et c'est délibéré. Écrire ici un numéro M-Pesa plausible serait
 * inventer une coordonnée bancaire : le client enverrait de l'argent à un
 * inconnu. Sans configuration, le fournisseur reste disponible (il n'a besoin
 * d'aucune clé) mais les instructions renvoient vers le support, ce qui est la
 * seule chose honnête à afficher.
 */
const NO_ACCOUNTS: readonly { label: string; value: string }[] = [];

/**
 * Décode `LALANDA_MANUAL_PAYMENT_ACCOUNTS` : `Libellé|Valeur;Libellé|Valeur`.
 *
 * Format plat plutôt que JSON parce que cette variable est saisie à la main par
 * une exploitante dans une console de déploiement : un JSON mal fermé y produit
 * une panne silencieuse au premier client, un point-virgule oublié n'ampute
 * qu'une ligne d'affichage.
 */
export function parseManualAccounts(raw: string | null): { label: string; value: string }[] {
  if (!raw) return [];
  return raw
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const sep = entry.indexOf('|');
      if (sep <= 0) return null;
      const label = entry.slice(0, sep).trim();
      const value = entry.slice(sep + 1).trim();
      return label && value ? { label, value } : null;
    })
    .filter((entry): entry is { label: string; value: string } => entry !== null);
}

export class ManualProvider implements PaymentProvider {
  readonly id = 'manual' as const;
  readonly methods: readonly PaymentMethod[] = ['mobile_money', 'bank_transfer'];

  constructor(private readonly secrets: PaymentSecretsResolver) {}

  /**
   * Toujours disponible : c'est le filet. Un fournisseur manuel indisponible
   * signifierait qu'aucun client congolais ne peut payer, ce qui est pire que
   * des instructions incomplètes.
   */
  async availability(): Promise<ProviderAvailability> {
    return { available: true, source: 'env', mode: 'n/a' };
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    const configured = await this.secrets.resolve('manual', 'accounts');
    const accounts = configured ? parseManualAccounts(configured.value) : NO_ACCOUNTS;

    return {
      provider: 'manual',
      mode: 'instructions',
      reference: request.reference,
      instructions: buildInstructions({
        method: request.method,
        amountDueCents: request.amountDueCents,
        currency: request.currency,
        reference: request.reference,
        accounts: [...accounts],
      }),
    };
  }

  /**
   * Le fournisseur manuel n'a PAS de rappel.
   *
   * Cette méthode existe parce que l'interface l'impose, et elle lève parce
   * qu'une route de rappel « manuel » serait exactement le trou de sécurité que
   * tout ce lot cherche à éviter : un point d'entrée non authentifié capable
   * d'accorder un abonnement. La confirmation passe par une route
   * authentifiée exigeant un rôle plateforme (`payments.controller.ts`).
   */
  async verifyAndParse(_request: WebhookRequest): Promise<NormalizedWebhookEvent> {
    throw new WebhookSignatureError(
      'manual',
      'aucun rappel externe accepté — la confirmation exige un administrateur authentifié',
    );
  }
}

/** Montant en centimes → « 9,00 USD ». Formatage stable, sans dépendance locale. */
function formatAmount(cents: number, currency: string): string {
  const units = Math.trunc(cents / 100);
  const remainder = Math.abs(cents % 100)
    .toString()
    .padStart(2, '0');
  return `${units},${remainder} ${currency}`;
}

export function buildInstructions(input: {
  method: PaymentMethod;
  amountDueCents: number;
  currency: string;
  reference: string;
  accounts: { label: string; value: string }[];
}): PaymentInstructions {
  const amount = formatAmount(input.amountDueCents, input.currency);
  const isMobile = input.method === 'mobile_money';

  const steps: string[] = [
    isMobile
      ? `Envoyez ${amount} depuis votre compte mobile money vers l'un des numéros ci-dessous.`
      : `Effectuez un virement de ${amount} vers l'un des comptes ci-dessous.`,
    // La référence est le seul lien entre un dépôt et une organisation. Sans
    // elle, un administrateur voit arriver de l'argent sans savoir à qui
    // l'attribuer — c'est le mode d'échec principal de ce fournisseur, il est
    // donc mis en première ligne et répété dans l'interface.
    `Indiquez impérativement la référence « ${input.reference} » dans le motif.`,
    `Votre abonnement est activé après vérification, sous ${MANUAL_CONFIRMATION_DELAY_HOURS} heures ouvrées.`,
  ];

  if (input.accounts.length === 0) {
    steps.splice(
      0,
      1,
      'Les coordonnées de dépôt ne sont pas encore publiées : contactez le support pour recevoir ' +
        `les instructions de paiement de ${amount}.`,
    );
  }

  return {
    title: isMobile ? 'Paiement par mobile money' : 'Paiement par virement',
    steps,
    accounts: input.accounts,
    expectedDelayHours: MANUAL_CONFIRMATION_DELAY_HOURS,
  };
}
