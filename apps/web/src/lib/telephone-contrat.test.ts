// ADR-0074 § 8 (qualité) — la valeur que `PhoneInput` transmet est acceptée telle
// quelle par chaque route qui reçoit un téléphone, et c'est déjà la forme E.164
// que WhatsApp stocke. Les motifs viennent de `@lalanda/shared` (ceux que l'API
// applique) ; ventes et fiche fiscale portent le même motif dans leur DTO de
// l'API (non exporté), recopié ci-dessous.

import { CRM_PHONE_PATTERN } from '@lalanda/shared/crm';
import { HR_PHONE_PATTERN } from '@lalanda/shared/hr';
import { PURCHASE_PHONE_PATTERN } from '@lalanda/shared/purchases';
import { normalizeWhatsAppPhone } from '@lalanda/shared/work';
import { afficherTelephone, ecrireTelephone, lireTelephone } from '@lalanda/ui';
import { describe, expect, it } from 'vitest';

/** Motif de `apps/api/src/sales/sales.dto.ts` et `fiscal/fiscal.dto.ts` (copie). */
const MOTIF_VENTES_FISCAL = /^\+?[0-9][0-9 .-]{6,19}$/;

const SAISIES = [
  '0812345678',
  '81 234 5678',
  '+243 81 234 5678',
  '00243812345678',
  '+243-81-234-5678',
];

function transmis(saisie: string): string {
  const { indicatif, national } = lireTelephone(saisie);
  return ecrireTelephone(indicatif, national);
}

describe('téléphone transmis : E.164 sans espace, accepté partout', () => {
  it('une seule forme, quelle que soit la saisie', () => {
    for (const s of SAISIES) expect(transmis(s)).toBe('+243812345678');
  });

  it('acceptée par les motifs des routes (ventes, CRM, RH, achats, fiche fiscale)', () => {
    for (const s of SAISIES) {
      const v = transmis(s);
      expect(MOTIF_VENTES_FISCAL.test(v)).toBe(true);
      expect(CRM_PHONE_PATTERN.test(v)).toBe(true);
      expect(HR_PHONE_PATTERN.test(v)).toBe(true);
      expect(PURCHASE_PHONE_PATTERN.test(v)).toBe(true);
    }
  });

  it('identique à ce que WhatsApp enregistre (normalisation E.164 de l’API)', () => {
    for (const s of SAISIES) expect(normalizeWhatsAppPhone(transmis(s))).toBe(transmis(s));
    const etranger = ecrireTelephone('+33', '6 12 34 56 78');
    expect(normalizeWhatsAppPhone(etranger)).toBe(etranger);
  });

  it('affiché groupé dans les fiches et les listes', () => {
    expect(afficherTelephone(transmis('0812345678'))).toBe('+243 81 234 5678');
  });
});
