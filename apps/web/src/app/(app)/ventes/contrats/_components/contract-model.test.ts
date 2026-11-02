import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { InvoiceLineBody, OrgAction } from '@/lib/api';
import type { EngagementLineView } from '@/lib/api-sales-contracts';

import * as modele from './contract-model';
import {
  approbation,
  aujourdhuiKinshasa,
  champsRefusesEngagement,
  clausesDepuisVue,
  clausesVides,
  echeanceVide,
  lignesEcheance,
  lireMotif,
  messageEngagement,
  motsInterdits,
  peutApprouverContrat,
  peutPreparerBrouillon,
  peutPreparerEngagement,
  preparerAcompte,
  preparerClauses,
  preparerResiliation,
  preparerSignature,
  quantitesDepuisEcheance,
  signatairesVides,
} from './contract-model';

const libre = (name: string, unitPrice: string, quantity = '1'): InvoiceLineBody => ({
  source: 'free',
  code: null,
  name,
  itemType: 'SER',
  taxGroup: 'B',
  outOfScope: false,
  unit: null,
  quantity,
  unitPrice,
  specificTax: null,
  discount: null,
});

const vueLigne = (
  name: string,
  unitPrice: string,
  quantity: string,
  lineRef: string,
): EngagementLineView =>
  ({
    index: Number(lineRef.slice(1)) - 1,
    lineRef,
    source: 'free',
    catalogItemId: null,
    name,
    unitPrice,
    quantity,
  }) as unknown as EngagementLineView;

describe('droits affichés (§ 8)', () => {
  const avec = (...a: OrgAction[]): OrgAction[] => a;
  it('préparer exige sales.contract, approuver sales.contract.approve', () => {
    expect(peutPreparerEngagement(avec('sales.read', 'sales.contract'))).toBe(true);
    expect(peutPreparerEngagement(avec('sales.read'))).toBe(false);
    expect(peutApprouverContrat(avec('sales.read', 'sales.contract'))).toBe(false);
    expect(peutApprouverContrat(avec('sales.contract.approve'))).toBe(true);
    expect(peutPreparerEngagement(null)).toBe(false);
  });
  it('un brouillon de facture exige sales.read et sales.manage', () => {
    expect(peutPreparerBrouillon(avec('sales.read', 'sales.manage'))).toBe(true);
    expect(peutPreparerBrouillon(avec('sales.read', 'sales.contract'))).toBe(false);
  });
});

describe('approbation (§ 8.3, séparation des tâches)', () => {
  const base = {
    actions: ['sales.read', 'sales.contract.approve'] as OrgAction[],
    etatPermet: true,
    moi: 'u1',
    soumisPar: 'u2',
    approbateurUniqueAdmis: true,
  };
  it('cachée sans sales.contract.approve, ou si l’état ne le permet pas', () => {
    expect(approbation({ ...base, actions: ['sales.contract'] }).visible).toBe(false);
    expect(approbation({ ...base, etatPermet: false }).visible).toBe(false);
  });
  it('visible sans note pour un autre que l’auteur', () => {
    expect(approbation(base)).toEqual({ visible: true, note: null });
  });
  it('l’auteur : visible avec la mention « approbateur unique » si le réglage l’admet', () => {
    const r = approbation({ ...base, soumisPar: 'u1' });
    expect(r.visible).toBe(true);
    expect(r.note).toContain('approbateur unique');
  });
  it('l’auteur : cachée si le réglage refuse l’approbateur unique', () => {
    const r = approbation({
      ...base,
      soumisPar: 'u3',
      creePar: 'u1',
      approbateurUniqueAdmis: false,
    });
    expect(r.visible).toBe(false);
    expect(r.note).not.toBeNull();
  });
});

describe('clauses saisies (§ 2.3)', () => {
  it('rend le corps, durée vide = indéterminée, sans reconduction : ni période ni nombre', () => {
    const f = { ...clausesVides('2027-01-15'), dureeMois: '', preavisJours: '30' };
    const r = preparerClauses(f, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps).toEqual({
      startDate: '2027-01-15',
      initialTermMonths: null,
      renewal: { mode: 'none', periodMonths: null, maxRenewals: null },
      noticeDays: 30,
      billing: { kind: 'none' },
      clauses: null,
    });
  });
  it('reconduction tacite : période exigée ; bornes du contrat d’API', () => {
    const f = { ...clausesVides('2027-01-15'), reconduction: 'tacit' as const, dureeMois: '121' };
    const r = preparerClauses(f, []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.champs['renewal.periodMonths']).toBeDefined();
    expect(r.champs['initialTermMonths']).toBeDefined();
  });
  it('abonnement mensuel : fréquence, ancre, moment et préparation transmis tels quels', () => {
    const f = {
      ...clausesVides('2027-01-31'),
      reconduction: 'tacit' as const,
      periodeMois: '12',
      facturation: 'recurring' as const,
      ancre: '2027-01-31',
    };
    const r = preparerClauses(f, []);
    expect(r.ok && r.corps.billing).toEqual({
      kind: 'recurring',
      frequency: 'monthly',
      anchorDate: '2027-01-31',
      timing: 'in_advance',
      autoPrepare: true,
    });
    expect(r.ok && r.corps.renewal).toEqual({ mode: 'tacit', periodMonths: 12, maxRenewals: null });
  });
  it('échéancier : chaque échéance porte ses quantités, aux prix du contrat, sans pourcentage', () => {
    const lignes = [libre('Conception', '1000.00', '1'), libre('Suivi', '200.00', '10')];
    const e1 = {
      ...echeanceVide(0),
      dueDate: '2027-02-01',
      label: 'Acompte de démarrage',
      quantites: { 0: '1' },
    };
    const e2 = {
      ...echeanceVide(1),
      dueDate: '2027-06-01',
      label: 'Solde',
      quantites: { 1: '10' },
    };
    const r = preparerClauses(
      { ...clausesVides('2027-01-15'), facturation: 'schedule', echeances: [e1, e2] },
      lignes,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.corps.billing.kind !== 'schedule') return;
    expect(
      r.corps.billing.items.map((i) =>
        i.lines.map((l) => [l.quantity, (l as { unitPrice: string }).unitPrice]),
      ),
    ).toEqual([[['1', '1000.00']], [['10', '200.00']]]);
  });
  it('échéancier : une échéance sans quantité est refusée', () => {
    const r = preparerClauses(
      {
        ...clausesVides('2027-01-15'),
        facturation: 'schedule',
        echeances: [{ ...echeanceVide(0), dueDate: '2027-02-01', label: 'x' }],
      },
      [libre('A', '1.00')],
    );
    expect(!r.ok && r.champs['billing.items.0.lines']).toBeTruthy();
  });
  it('lignesEcheance ignore les lignes vides et signale une quantité mal formée', () => {
    const r = lignesEcheance([libre('A', '1.00'), libre('B', '2.00')], { 0: '2,5', 1: 'abc' });
    expect(r.lignes.map((l) => l.quantity)).toEqual(['2.5']);
    expect(r.erreurs[1]).toBeDefined();
  });
  it('quantitesDepuisEcheance rapproche par désignation et prix, sans deviner', () => {
    const contrat = [vueLigne('A', '10.00', '5', 'L1'), vueLigne('B', '20.00', '1', 'L2')];
    const echeance = [vueLigne('B', '20.00', '1', 'L1'), vueLigne('Z', '1.00', '1', 'L2')];
    expect(quantitesDepuisEcheance(contrat, echeance)).toEqual({
      quantites: { 1: '1' },
      ignorees: 1,
    });
  });
  it('clausesDepuisVue relit un contrat récurrent', () => {
    const f = clausesDepuisVue({
      startDate: '2027-01-15',
      initialTermMonths: 12,
      renewal: { mode: 'tacit', periodMonths: 12, maxRenewals: 2 },
      noticeDays: 30,
      billing: {
        kind: 'recurring',
        frequency: 'quarterly',
        anchorDate: '2027-01-31',
        timing: 'in_arrears',
        autoPrepare: false,
      },
      clauses: 'Texte',
      lines: [],
    });
    expect(f).toMatchObject({
      dureeMois: '12',
      reconduction: 'tacit',
      periodeMois: '12',
      maxReconductions: '2',
      preavisJours: '30',
      facturation: 'recurring',
      frequence: 'quarterly',
      moment: 'in_arrears',
      autoPrepare: false,
      clauses: 'Texte',
    });
  });
});

describe('acompte (§ 5.1, décision ouverte n° 12)', () => {
  it('le groupe de taxation n’est jamais prérempli', () => {
    expect(modele.acompteVide().groupe).toBe('');
    const r = preparerAcompte({ type: 'FT', montant: '500', groupe: '', libelle: '' }, 3);
    expect(!r.ok && r.champs['taxGroup']).toBeTruthy();
  });
  it('corps : montant en chaîne, groupe choisi, aucun pourcentage', () => {
    const r = preparerAcompte({ type: 'ET', montant: '1 250,50', groupe: 'B', libelle: '' }, 3);
    expect(r).toEqual({
      ok: true,
      corps: { expectedRevision: 3, type: 'ET', requestedAmount: '1250.50', taxGroup: 'B' },
    });
  });
});

describe('signature déclarée et résiliation', () => {
  it('exige la copie signée et un signataire de chaque côté', () => {
    const vides = signatairesVides();
    const r = preparerSignature({
      expectedRevision: 1,
      date: '2027-01-10',
      signataires: vides,
      fichierChoisi: false,
    });
    expect(!r.ok && r.champs['file']).toBeTruthy();
    expect(!r.ok && r.champs['signatories']).toBeTruthy();
    const remplis = vides.map((s, i) => ({ ...s, nom: `Nom ${i}` }));
    const ok = preparerSignature({
      expectedRevision: 1,
      date: '2027-01-10',
      signataires: remplis,
      fichierChoisi: true,
    });
    expect(ok.ok && ok.corps.signatories.map((s) => s.side)).toEqual(['customer', 'organization']);
  });
  it('résiliation : la date d’effet ne précède pas la notification ; motif exigé', () => {
    const r = preparerResiliation({
      expectedRevision: 1,
      notifieeLe: '2027-12-01',
      par: 'customer',
      effetLe: '2027-11-01',
      motif: '',
    });
    expect(!r.ok && r.champs['effectiveOn']).toBeTruthy();
    expect(!r.ok && r.champs['reason']).toBeTruthy();
    const ok = preparerResiliation({
      expectedRevision: 1,
      notifieeLe: '2027-12-01',
      par: 'customer',
      effetLe: '2028-01-14',
      motif: ' Fin ',
    });
    expect(ok.ok && ok.corps).toEqual({
      expectedRevision: 1,
      noticeGivenOn: '2027-12-01',
      by: 'customer',
      effectiveOn: '2028-01-14',
      reason: 'Fin',
    });
  });
  it('lireMotif', () => {
    expect(lireMotif('  ok ')).toBe('ok');
    expect(lireMotif('   ')).toEqual({ erreur: 'Motif obligatoire.' });
  });
});

describe('messages et refus', () => {
  it('traduit les codes métier et les refus de droit', () => {
    expect(
      messageEngagement({ status: 409, detail: { code: 'SELF_APPROVAL_FORBIDDEN' } }, 'x'),
    ).toContain('une autre personne habilitée');
    expect(messageEngagement({ status: 403 }, 'x')).toBe('Votre rôle ne permet pas cette action.');
    expect(messageEngagement({ status: 409, detail: { message: 'Autre.' } }, 'x')).toBe('Autre.');
  });
  it('champsRefusesEngagement relit details.issues', () => {
    expect(
      champsRefusesEngagement({
        detail: { details: { issues: [{ path: ['billing', 'anchorDate'], message: 'm' }] } },
      }),
    ).toEqual({ 'billing.anchorDate': 'm' });
  });
  it('jour civil de Kinshasa (UTC+1)', () => {
    expect(aujourdhuiKinshasa(new Date('2027-01-14T23:30:00Z'))).toBe('2027-01-15');
  });
});

describe('mots interdits (critère 18)', () => {
  it('aucun libellé exporté par le modèle ne les porte', () => {
    const textes: string[] = [];
    for (const v of Object.values(modele)) {
      if (typeof v === 'object' && v !== null) {
        JSON.stringify(v, (_k, x: unknown) => {
          if (typeof x === 'string') textes.push(x);
          return x;
        });
      }
    }
    expect(textes.length).toBeGreaterThan(20);
    expect(textes.flatMap(motsInterdits)).toEqual([]);
  });

  it('aucun écran des commandes, des contrats ni du bloc du devis ne les porte', () => {
    const ici = fileURLToPath(new URL('.', import.meta.url));
    const dossiers = [
      join(ici, '..'),
      join(ici, '../../commandes'),
      join(ici, '../../devis/[quoteId]'),
    ];
    const fichiers: string[] = [];
    const parcourir = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) parcourir(p);
        else if (/\.(ts|tsx)$/.test(n) && !n.endsWith('.test.ts')) fichiers.push(p);
      }
    };
    dossiers.forEach(parcourir);
    expect(fichiers.length).toBeGreaterThan(10);
    const trouves = fichiers.flatMap((f) =>
      motsInterdits(readFileSync(f, 'utf8')).map((m) => `${f}: ${m}`),
    );
    expect(trouves).toEqual([]);
  });
});
