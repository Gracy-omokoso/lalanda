import { describe, expect, it } from 'vitest';

import type { OrgAction } from '@/lib/api';

import {
  RAISON_DEJA_APPROUVE,
  RAISON_PROPRE_DEMANDE,
  RAISON_SANS_APPROBATION,
  actionsCommande,
  formulaireCommande,
  lirePrix,
  lireQuantite,
  numeroCommande,
  phraseApprobations,
  preparerCommande,
  requeteCommandes,
} from './commandes-model';
import { commande } from './fixtures.test-utils';

const DIRECTEUR: OrgAction[] = [
  'purchase.read',
  'purchase.request',
  'purchase.manage',
  'purchase.approve',
];
const ANALYSTE: OrgAction[] = ['purchase.read', 'purchase.request'];
const ADMIN: OrgAction[] = ['purchase.read', 'purchase.request', 'purchase.manage'];

const ids = (l: { id: string }[]) => l.map((a) => a.id);

describe('liste', () => {
  it('filtres → requête', () => {
    expect(requeteCommandes('miennes')).toEqual({ limit: 50, requestedBy: 'me' });
    expect(requeteCommandes('a-approuver', 'c1')).toEqual({
      limit: 50,
      cursor: 'c1',
      status: 'submitted',
    });
    expect(requeteCommandes('commandes')).toMatchObject({ phase: 'order' });
  });
  it('numéro : BC, sinon DA, sinon brouillon', () => {
    expect(numeroCommande({ orderNumber: 'BC1', requestNumber: 'DA1' })).toBe('BC1');
    expect(numeroCommande({ orderNumber: null, requestNumber: 'DA1' })).toBe('DA1');
    expect(numeroCommande({ orderNumber: null, requestNumber: null })).toMatch(/Brouillon/);
  });
  it('progression des approbations, sans calcul de montant', () => {
    expect(phraseApprobations(commande({ requiredApprovals: null }))).toBeNull();
    expect(phraseApprobations(commande({ requiredApprovals: 0 }))).toMatch(/Aucune/);
    expect(
      phraseApprobations(
        commande({
          requiredApprovals: 2,
          approvals: [
            { userId: 'a', decision: 'approved', at: '', comment: null, soleApprover: false },
          ],
        }),
      ),
    ).toBe('1 approbation sur 2 requises');
  });
});

describe('boutons selon les droits et la séparation des tâches', () => {
  const ctx = (actions: OrgAction[], moi: string | null, enAttente: boolean | null = null) => ({
    actions,
    moi,
    enAttentePourMoi: enAttente,
  });

  it('sans `purchase.approve` : approuver et refuser visibles mais désactivés, avec la raison', () => {
    const l = actionsCommande(commande(), ctx(ADMIN, 'u-admin'));
    const approuver = l.find((a) => a.id === 'approuver')!;
    expect(approuver.actif).toBe(false);
    expect(approuver.raison).toBe(RAISON_SANS_APPROBATION);
    expect(l.find((a) => a.id === 'refuser')!.actif).toBe(false);
  });

  it('le demandeur approbateur : désactivé, sauf si l’API le met dans SA liste (approbateur unique)', () => {
    const o = commande({ requestedBy: 'u-dir', createdBy: 'u-dir' });
    expect(actionsCommande(o, ctx(DIRECTEUR, 'u-dir', false)).find((a) => a.id === 'approuver')!
      .raison).toBe(RAISON_PROPRE_DEMANDE);
    expect(
      actionsCommande(o, ctx(DIRECTEUR, 'u-dir', true)).find((a) => a.id === 'approuver')!.actif,
    ).toBe(true);
  });

  it('palier à deux : qui a déjà approuvé ne le refait pas', () => {
    const o = commande({
      requiredApprovals: 2,
      approvals: [
        { userId: 'u-dir', decision: 'approved', at: '', comment: null, soleApprover: false },
      ],
    });
    expect(
      actionsCommande(o, ctx(DIRECTEUR, 'u-dir', false)).find((a) => a.id === 'approuver')!.raison,
    ).toBe(RAISON_DEJA_APPROUVE);
  });

  it('un autre approbateur : actif', () => {
    const a = actionsCommande(commande(), ctx(DIRECTEUR, 'u-dir', null)).find(
      (x) => x.id === 'approuver',
    )!;
    expect(a).toEqual({ id: 'approuver', libelle: 'Approuver', actif: true, raison: null });
  });

  it('brouillon : soumettre pour son auteur ; absent pour un autre analyste', () => {
    const o = commande({ status: 'draft', requestNumber: null, requiredApprovals: null });
    expect(ids(actionsCommande(o, ctx(ANALYSTE, 'u-demandeur')))).toEqual([
      'soumettre',
      'supprimer',
    ]);
    expect(ids(actionsCommande(o, ctx(ANALYSTE, 'u-autre')))).toEqual([]);
    expect(ids(actionsCommande(o, ctx(ADMIN, 'u-admin')))).toEqual(['soumettre', 'supprimer']);
  });

  it('bon de commande approuvé : aperçu, envoi manuel, annulation, duplication', () => {
    const o = commande({ phase: 'order', status: 'approved', orderNumber: 'BC2610-000001' });
    expect(ids(actionsCommande(o, ctx(ADMIN, 'u-admin')))).toEqual([
      'apercu',
      'marquer-envoyee',
      'annuler',
      'dupliquer',
    ]);
    expect(ids(actionsCommande(o, ctx(['purchase.read'], 'u-x')))).toEqual(['apercu']);
  });

  it('refusée : seule la duplication reste', () => {
    expect(ids(actionsCommande(commande({ status: 'rejected' }), ctx(DIRECTEUR, 'u')))).toEqual([
      'dupliquer',
    ]);
  });
});

describe('saisie', () => {
  it('quantités et prix à la française', () => {
    expect(lireQuantite('2,5')).toEqual({ ok: true, valeur: '2.5' });
    expect(lireQuantite('0').ok).toBe(false);
    expect(lireQuantite('1,2345').ok).toBe(false);
    expect(lirePrix('1 234,50')).toEqual({ ok: true, valeur: '1234.50' });
    expect(lirePrix('0')).toEqual({ ok: true, valeur: '0' });
    expect(lirePrix('1,234').ok).toBe(false);
  });

  it('corps de création : chaînes décimales, aucun total calculé', () => {
    const f = formulaireCommande('USD', 's1');
    f.title = ' Fournitures ';
    f.lignes = [{ label: 'Rames', kind: 'goods', quantity: '10', unit: 'u', unitPrice: '5,00' }];
    f.taxes = [{ label: 'TVA', amount: '8' }];
    const r = preparerCommande(f);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corps).toEqual({
      title: 'Fournitures',
      justification: null,
      supplierId: 's1',
      currency: 'USD',
      lines: [{ label: 'Rames', kind: 'goods', quantity: '10', unitPrice: '5.00', unit: 'u' }],
      declaredTaxes: [{ label: 'TVA', amount: '8' }],
      expectedOn: null,
      deliveryAddress: null,
    });
    expect(r.corps).not.toHaveProperty('totals');
  });

  it('erreurs par champ et par ligne', () => {
    const f = formulaireCommande();
    f.lignes = [{ label: '', kind: 'service', quantity: 'x', unit: '', unitPrice: '' }];
    const r = preparerCommande(f);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.champs).sort()).toEqual([
      'ligne-0-label',
      'ligne-0-quantity',
      'ligne-0-unitPrice',
      'title',
    ]);
  });
});
