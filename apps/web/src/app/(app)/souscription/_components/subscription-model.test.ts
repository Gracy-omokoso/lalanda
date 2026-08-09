// Lecture d'un état d'abonnement (S22b).
//
// Les six statuts de docs/13 produisent six écrans différents. Ces tests
// vérifient que chacun dit la vérité — en particulier les trois qui annoncent
// une mauvaise nouvelle, où une phrase imprécise coûte un client.

import { describe, expect, it } from 'vitest';

import type { PlanQuoteView, SubscriptionStateView, SubscriptionStatus } from '@/lib/api';

import {
  cheminDepuisChiffrage,
  codeErreur,
  estRefusAutorisation,
  etatAffiche,
  formatCents,
  formatDate,
  isManualMethod,
  joursOuZero,
  messageRefus,
  peutDemarrerEssai,
  PLAN_LABELS,
  STATUS_LABELS,
} from './subscription-model';

function etat(patch: Partial<SubscriptionStateView> = {}): SubscriptionStateView {
  return {
    plan: 'free',
    entitlements: { maxProjects: 1, pdfWatermark: true },
    usage: { projects: 0 },
    subscribedPlan: 'free',
    status: 'canceled',
    billingInterval: 'month',
    paidAccess: false,
    trial: { used: false, endsAt: null, daysLeft: null, eligible: true, days: 14 },
    currentPeriodEnd: null,
    grace: { endsAt: null, daysLeft: null, days: 7 },
    pendingChange: null,
    provider: null,
    notice: null,
    ...patch,
  };
}

function chiffrage(patch: Partial<PlanQuoteView> = {}): PlanQuoteView {
  return {
    plan: 'pro',
    interval: 'month',
    direction: 'upgrade',
    effect: 'immediate',
    amountDueCents: 900,
    creditCents: 0,
    carriedCreditCents: 0,
    currency: 'USD',
    taxIncluded: false,
    effectiveAt: null,
    ...patch,
  };
}

describe('libellés', () => {
  it('couvre les six statuts de la machine (docs/13)', () => {
    const statuses: SubscriptionStatus[] = [
      'trialing',
      'active',
      'past_due',
      'grace',
      'suspended',
      'canceled',
    ];
    for (const status of statuses) {
      expect(STATUS_LABELS[status]).toBeTruthy();
      // Un statut sans écran serait un client bloqué devant une page muette.
      expect(etatAffiche(etat({ status })).titre.length).toBeGreaterThan(0);
    }
  });

  it('couvre les trois offres', () => {
    for (const plan of ['free', 'pro', 'business'] as const) {
      expect(PLAN_LABELS[plan]).toBeTruthy();
    }
  });
});

describe('état affiché en haut du tunnel', () => {
  it("annonce les jours d'essai restants", () => {
    const vue = etatAffiche(
      etat({
        status: 'trialing',
        plan: 'pro',
        paidAccess: true,
        trial: { ...etat().trial, used: true, daysLeft: 5, eligible: false },
      }),
    );
    expect(vue.ton).toBe('info');
    expect(vue.titre).toContain('5');
    // La promesse « aucun projet supprimé » doit être devant les yeux du client
    // AU MOMENT où il décide, pas seulement dans la FAQ.
    expect(vue.detail).toContain('supprimé');
  });

  it('un paiement en échec ne dramatise pas : l’accès est encore ouvert', () => {
    const vue = etatAffiche(etat({ status: 'past_due', paidAccess: true, subscribedPlan: 'pro' }));
    expect(vue.ton).toBe('attention');
    expect(vue.detail.toLowerCase()).toContain('reste ouvert');
  });

  it('une grâce annonce le décompte avant suspension', () => {
    const vue = etatAffiche(
      etat({ status: 'grace', paidAccess: true, grace: { endsAt: null, daysLeft: 3, days: 7 } }),
    );
    expect(vue.ton).toBe('critique');
    expect(vue.detail).toContain('3');
  });

  it("une suspension dit explicitement qu'aucune donnée n'est perdue", () => {
    const vue = etatAffiche(etat({ status: 'suspended', subscribedPlan: 'business' }));
    expect(vue.ton).toBe('critique');
    // C'est LA question d'un client suspendu. Ne pas y répondre le fait appeler
    // le support, ou pire, partir.
    expect(vue.detail.toLowerCase()).toContain('supprim');
  });

  it('un changement programmé est annoncé sur un abonnement actif', () => {
    const vue = etatAffiche(
      etat({
        status: 'active',
        subscribedPlan: 'business',
        paidAccess: true,
        pendingChange: { plan: 'pro', interval: 'month', effectiveAt: '2026-09-01T00:00:00.000Z' },
      }),
    );
    expect(vue.ton).toBe('succes');
    expect(vue.detail).toContain('Pro');
  });

  it('le message du serveur prime sur le texte local quand il existe', () => {
    // Sinon, deux textes finissent par diverger et c'est l'affichage qui ment.
    const vue = etatAffiche(
      etat({
        status: 'past_due',
        notice: { level: 'warning', message: 'Carte expirée le 30 juin.' },
      }),
    );
    expect(vue.detail).toBe('Carte expirée le 30 juin.');
  });

  it('distingue un essai jamais utilisé d’un essai déjà consommé', () => {
    const neuf = etatAffiche(etat({ status: 'canceled' }));
    expect(neuf.detail.toLowerCase()).toContain('essai gratuit');
    const consomme = etatAffiche(
      etat({ status: 'canceled', trial: { ...etat().trial, used: true, eligible: false } }),
    );
    expect(consomme.detail.toLowerCase()).toContain('déjà');
  });
});

describe('proposition d’essai', () => {
  it("suit l'éligibilité décidée par le serveur", () => {
    expect(peutDemarrerEssai(etat({ trial: { ...etat().trial, eligible: true } }))).toBe(true);
    expect(peutDemarrerEssai(etat({ trial: { ...etat().trial, eligible: false } }))).toBe(false);
  });

  it('ne propose jamais un essai à qui a déjà un accès payant', () => {
    // Serait une régression déguisée en offre : passer de Business payé à Pro
    // offert pendant quatorze jours.
    const state = etat({
      status: 'active',
      paidAccess: true,
      trial: { ...etat().trial, eligible: true },
    });
    expect(peutDemarrerEssai(state)).toBe(false);
  });
});

describe('chemin après chiffrage', () => {
  it('une montée en gamme mène au paiement', () => {
    const chemin = cheminDepuisChiffrage(chiffrage({ direction: 'upgrade', effect: 'immediate' }));
    expect(chemin.type).toBe('paiement');
  });

  it('une montée en gamme avec crédit annonce le montant déduit', () => {
    const chemin = cheminDepuisChiffrage(chiffrage({ creditCents: 450 }));
    expect(chemin.raison).toContain('4,50 USD');
  });

  it('une baisse de gamme est programmée, jamais encaissée', () => {
    const chemin = cheminDepuisChiffrage(
      chiffrage({ direction: 'downgrade', effect: 'period_end', amountDueCents: 0 }),
    );
    expect(chemin.type).toBe('programme');
    expect(chemin.raison.toLowerCase()).toContain('échéance');
  });

  it('choisir son offre actuelle ne mène nulle part, et le dit', () => {
    const chemin = cheminDepuisChiffrage(chiffrage({ direction: 'same', effect: 'period_end' }));
    expect(chemin.type).toBe('aucun');
  });
});

describe('formatage', () => {
  it('affiche les centimes sans flottant ni séparateur dépendant de la locale', () => {
    expect(formatCents(900)).toBe('9,00 USD');
    expect(formatCents(4900)).toBe('49,00 USD');
    expect(formatCents(0)).toBe('0,00 USD');
    expect(formatCents(5)).toBe('0,05 USD');
    // Un montant négatif ne devrait jamais atteindre l'affichage, mais s'il y
    // arrive il doit rester lisible plutôt que produire « -0,-5 ».
    expect(formatCents(-450)).toBe('-4,50 USD');
  });

  it('ramène un décompte absent ou négatif à zéro', () => {
    expect(joursOuZero(null)).toBe(0);
    expect(joursOuZero(-3)).toBe(0);
    expect(joursOuZero(5)).toBe(5);
  });

  it('formate une date et tolère une valeur absente ou invalide', () => {
    expect(formatDate('2026-08-09T12:00:00.000Z')).toContain('2026');
    expect(formatDate(null)).toBe('—');
    expect(formatDate('pas-une-date')).toBe('—');
  });
});

describe('moyens de paiement manuels', () => {
  it('identifie ceux qui exigent une confirmation humaine', () => {
    expect(isManualMethod('mobile_money')).toBe(true);
    expect(isManualMethod('bank_transfer')).toBe(true);
    expect(isManualMethod('card')).toBe(false);
    expect(isManualMethod('paypal')).toBe(false);
  });
});

describe('refus de l’API', () => {
  function refus(code: string, status = 409): unknown {
    return Object.assign(new Error('refus'), { status, detail: { code } });
  }

  it('extrait le code d’un refus', () => {
    expect(codeErreur(refus('TRIAL_ALREADY_USED'))).toBe('TRIAL_ALREADY_USED');
    expect(codeErreur(new Error('réseau'))).toBeNull();
    expect(codeErreur(null)).toBeNull();
  });

  it('traduit chaque refus attendu en consigne actionnable', () => {
    const codes = [
      'TRIAL_ALREADY_USED',
      'SUBSCRIPTION_ACTIVE',
      'PLAN_NOT_SELLABLE',
      'UPGRADE_REQUIRES_PAYMENT',
      'DOWNGRADE_NOT_PAYABLE',
      'ALREADY_CANCELED',
      'PROVIDER_UNAVAILABLE',
      'NO_SUBSCRIPTION',
      'INVALID_PLAN_OR_INTERVAL',
    ];
    for (const code of codes) {
      const message = messageRefus(refus(code), 'défaut');
      expect(message).not.toBe('défaut');
      // Le code brut ne doit jamais atteindre le client.
      expect(message).not.toContain(code);
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it('retombe sur le message par défaut pour un refus inconnu', () => {
    expect(messageRefus(refus('CE_CODE_NEXISTE_PAS'), 'défaut')).toBe('défaut');
    expect(messageRefus(new Error('réseau'), 'défaut')).toBe('défaut');
  });

  it('reconnaît un refus d’autorisation', () => {
    expect(estRefusAutorisation(refus('FORBIDDEN', 403))).toBe(true);
    expect(estRefusAutorisation(refus('TRIAL_ALREADY_USED', 409))).toBe(false);
  });
});
