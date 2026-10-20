// ─────────────────────────────────────────────────────────────────────────────
// Assujettissement du vendeur et groupes de taxation (ADR-0023 § S25e.6,
// amendement du 20 oct. 2026)
//
// Constat de production du 20 oct. 2026 : une facture a été émise en groupe B
// (16 %) par une organisation dont la fiche fiscale indiquait « non assujettie à
// la TVA », sans que rien ne l'en avertisse.
//
// Règle reprise, en substance, de la documentation du compte développeur DGI
// (« Groupes de taxation », v1.2, p. 1 à 4, et annexe de la note de service
// n° 01/022, p. 3 à 7 — pièces non publiques, hors dépôt) :
//
// - groupe K « Opérations réalisées par les non-assujettis » : entreprises
//   n'ayant pas atteint le seuil d'assujettissement ; la TVA n'est pas facturée ;
//   c'est LE groupe prévu pour un vendeur non assujetti (cas de test officiel
//   n° 22 « vendeur non assujetti » : FV, 2 × K) ;
// - groupes B, C, O (taxables 16 %, 5 %, 1 %), F, G, P (marchés publics à
//   financement extérieur), D (régimes dérogatoires), M (ventes réglementées à
//   TVA spécifique) et N (TVA spécifique, entièrement de la TVA) : la définition
//   DGI les réserve à une opération « réalisée par une entreprise assujettie » ou
//   ils facturent de la TVA ⇒ INTERDITS à un vendeur non assujetti ;
// - groupe A : l'opération EXONÉRÉE est « réalisée par une entreprise assujettie »
//   ⇒ interdite ; l'opération HORS CHAMP (pas réalisée par un assujetti agissant
//   comme tel) reste permise ;
// - groupes E (exportation, « taxables ou non »), H (consignation d'emballage),
//   I (garantie et caution), J (débours), L (prélèvements sur ventes) : hors
//   base de TVA, sans condition d'assujettissement dans la définition DGI ⇒
//   permis. Point soumis à la DGI (ADR-0023, questions).
//
// Inversement, K appliqué par un vendeur ASSUJETTI contredit sa définition
// (entreprise sous le seuil) : c'est un AVERTISSEMENT, jamais bloquant — la fiche
// fiscale peut être en retard sur la réalité et la DGI n'a pas tranché.
//
// Aucun montant ici : ce contrôle ne lit que les lettres de groupe.
// ─────────────────────────────────────────────────────────────────────────────

import type { OriginLine } from './invoice-checks.types.js';
import { taxGroupDefinition } from './tax-groups.js';
import type { TaxGroupLetter } from './types.js';

/** Position d'une ligne (entier), sans écrire le type flottant natif. */
type Index = OriginLine['index'];

/** Groupes interdits à un vendeur non assujetti, quelle que soit la ligne. */
export const TAX_GROUPS_RESERVED_TO_VAT_REGISTERED: readonly TaxGroupLetter[] = Object.freeze([
  'B',
  'C',
  'D',
  'F',
  'G',
  'M',
  'N',
  'O',
  'P',
] as const);

/** Groupe prévu par la DGI pour les opérations des non-assujettis. */
export const NON_VAT_REGISTERED_TAX_GROUP: TaxGroupLetter = 'K';

export type SellerVatStatusIssueCode = 'TAX_GROUP_REQUIRES_VAT_REGISTRATION';
export type SellerVatStatusWarningCode = 'TAX_GROUP_K_WHILE_VAT_REGISTERED';

export interface SellerVatStatusFinding<C extends string> {
  code: C;
  lineIndex: Index;
  /** Message en français, affichable tel quel (la ligne est ajoutée par l'interface). */
  message: string;
  details: Readonly<{ taxGroup: TaxGroupLetter }>;
}

export interface SellerVatStatusLine {
  taxGroup: TaxGroupLetter;
  /** Opération hors champ (groupe A seulement). */
  outOfScope: boolean;
}

export interface SellerVatStatusInput {
  /** `vatRegistered` de la fiche fiscale (lue au gel, figée dans `seller`). */
  vatRegistered: boolean;
  lines: readonly SellerVatStatusLine[];
}

export interface SellerVatStatusCheck {
  /** `false` dès qu'un problème bloquant existe ; les avertissements n'y comptent pas. */
  ok: boolean;
  issues: readonly SellerVatStatusFinding<SellerVatStatusIssueCode>[];
  warnings: readonly SellerVatStatusFinding<SellerVatStatusWarningCode>[];
}

const RESERVED: readonly string[] = TAX_GROUPS_RESERVED_TO_VAT_REGISTERED;

function requiresVatRegistration(line: SellerVatStatusLine): boolean {
  if (line.taxGroup === 'A') return !line.outOfScope;
  return RESERVED.includes(line.taxGroup);
}

function groupName(group: TaxGroupLetter): string {
  return `groupe ${group} (${taxGroupDefinition(group).label})`;
}

/**
 * Contrôle les groupes des lignes contre l'assujettissement du vendeur. Rend TOUS
 * les problèmes, ligne par ligne, dans l'ordre des lignes.
 */
export function checkSellerVatStatus(input: SellerVatStatusInput): SellerVatStatusCheck {
  const issues: SellerVatStatusFinding<SellerVatStatusIssueCode>[] = [];
  const warnings: SellerVatStatusFinding<SellerVatStatusWarningCode>[] = [];
  input.lines.forEach((line, lineIndex) => {
    if (!input.vatRegistered && requiresVatRegistration(line)) {
      const what =
        line.taxGroup === 'A'
          ? 'une opération exonérée (groupe A) est réservée aux assujettis'
          : `le ${groupName(line.taxGroup)} est réservé aux assujettis`;
      issues.push({
        code: 'TAX_GROUP_REQUIRES_VAT_REGISTRATION',
        lineIndex,
        message:
          'Votre profil fiscal indique que l’entreprise n’est pas assujettie à la TVA : ' +
          `${what}. Utilisez le groupe K (opérations des non-assujettis) ou mettez à jour ` +
          'le profil fiscal.',
        details: Object.freeze({ taxGroup: line.taxGroup }),
      });
    }
    if (input.vatRegistered && line.taxGroup === NON_VAT_REGISTERED_TAX_GROUP) {
      warnings.push({
        code: 'TAX_GROUP_K_WHILE_VAT_REGISTERED',
        lineIndex,
        message:
          'Votre profil fiscal indique que l’entreprise est assujettie à la TVA, mais cette ' +
          'ligne utilise le groupe K, réservé aux opérations des non-assujettis. Vérifiez le ' +
          'groupe de l’article ou le profil fiscal.',
        details: Object.freeze({ taxGroup: line.taxGroup }),
      });
    }
  });
  return { ok: issues.length === 0, issues, warnings };
}
