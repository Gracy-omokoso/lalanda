// Écrans CRM — ADR-0035 § 5 : ce que ces tests protègent, c'est ce qu'on casse
// sans que le typecheck le dise : un pourcentage affiché sans échantillon
// suffisant, deux devises additionnées, un montant passé par `Number()`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  erreursImport,
  etapesVoisines,
  formulaireOpportunite,
  interlocuteur,
  lienActivite,
  lienCompte,
  lienOpportunite,
  libelleProbabilite,
  messageCrm,
  montantEstime,
  peutGererCrm,
  peutConvertirCompte,
  peutLireCrm,
  peutPreparerDevis,
  preparerActivite,
  preparerContact,
  preparerOpportunite,
  rattachementContact,
  totauxColonne,
} from './crm-model';

const ETAPES = [
  { key: 'lead', label: 'Lead', kind: 'open' as const },
  { key: 'proposal', label: 'Proposition', kind: 'open' as const },
  { key: 'won', label: 'Gagné', kind: 'won' as const },
  { key: 'lost', label: 'Perdu', kind: 'lost' as const },
];

describe('CRM — modèle d’écran', () => {
  it('accès lus dans les permissions', () => {
    expect(peutLireCrm(['crm.read'])).toBe(true);
    expect(peutGererCrm(['crm.read'])).toBe(false);
    expect(peutGererCrm(null)).toBe(false);
  });

  it('la fiche d’opportunité vit sous /crm/opportunites (ADR-0040 § 8.1)', () => {
    expect(lienOpportunite('abc')).toBe('/crm/opportunites/abc');
    expect(lienOpportunite('a/b')).toBe('/crm/opportunites/a%2Fb');
  });

  it('probabilité : jamais de pourcentage sous l’échantillon minimal', () => {
    expect(
      libelleProbabilite({ status: 'unavailable', sample: 3, won: 2, requiredSample: 10 }),
    ).toBe('Probabilité indisponible : 3 opportunités clôturées sur 10 nécessaires');
    expect(libelleProbabilite({ status: 'available', ratePercent: '60', sample: 10, won: 6 })).toBe(
      'Probabilité historique : 60 % (6 gagnées sur 10)',
    );
    expect(libelleProbabilite(null)).toBeNull();
  });

  it('totaux par devise, recopiés de l’API, jamais additionnés entre devises', () => {
    expect(
      totauxColonne([
        { currency: 'CDF', total: '250000.00', count: 2 },
        { currency: 'USD', total: '1500.00', count: 1 },
      ]),
    ).toEqual([
      `${formatMontant('250000.00', 'CDF')} · 2 opp.`,
      `${formatMontant('1500.00', 'USD')} · 1 opp.`,
    ]);
    expect(montantEstime({ amount: null, currency: 'CDF' })).toBe('Montant non estimé');
  });

  it('déplacement au clavier : étape suivante, puis « gagné » ; jamais au-delà', () => {
    expect(etapesVoisines(ETAPES, 'lead')).toEqual({ precedente: null, suivante: ETAPES[1] });
    expect(etapesVoisines(ETAPES, 'proposal').suivante).toEqual(ETAPES[2]);
    expect(etapesVoisines(ETAPES, 'won')).toEqual({ precedente: ETAPES[1], suivante: null });
  });

  it('opportunité : un compte obligatoire, montant lu à la française en chaîne', () => {
    const f = { ...formulaireOpportunite(), title: 'Caisse' };
    expect(preparerOpportunite(f)).toEqual({
      ok: false,
      champs: { accountId: 'Choisissez un compte (prospect ou client).' },
    });
    const ok = preparerOpportunite({
      ...f,
      accountId: 'a1',
      montant: '1 500,5',
      currency: 'USD',
    });
    expect(ok).toEqual({
      ok: true,
      corps: {
        title: 'Caisse',
        accountId: 'a1',
        contactId: null,
        amount: '1500.5',
        currency: 'USD',
        expectedCloseDate: null,
        amountSource: 'manual',
      },
    });
    // Montant tiré des lignes : la saisie est ignorée, le responsable choisi part.
    const lignes = preparerOpportunite(
      { ...f, accountId: 'a1', montant: 'xx', ownerId: 'u2' },
      'lines',
    );
    expect(lignes.ok && lignes.corps).toMatchObject({
      amount: null,
      amountSource: 'lines',
      ownerId: 'u2',
    });
  });

  it('liens des comptes et des activités (ADR-0040 § 8.1, § 5.2)', () => {
    expect(lienCompte('a/1')).toBe('/crm/comptes/a%2F1');
    expect(lienActivite('x1')).toBe('/crm/activites?activite=x1');
  });

  it('droits : devis (`sales.quote`), conversion (`crm.manage` + `sales.manage`)', () => {
    expect(peutPreparerDevis(['sales.quote'])).toBe(true);
    expect(peutPreparerDevis(['sales.manage'])).toBe(false);
    expect(peutConvertirCompte(['crm.manage'])).toBe(false);
    expect(peutConvertirCompte(['crm.manage', 'sales.manage'])).toBe(true);
    expect(peutConvertirCompte(null)).toBe(false);
  });

  it('interlocuteur : le client, sinon le compte prospect', () => {
    expect(interlocuteur({ customerName: 'ACME', prospectName: null, accountName: 'ACME' })).toBe(
      'ACME',
    );
    expect(interlocuteur({ customerName: null, prospectName: null, accountName: 'Awa' })).toBe(
      'Awa (prospect)',
    );
    expect(interlocuteur({ customerName: null, prospectName: null })).toBe('—');
  });

  it('contact rattaché à un compte, ou sans entreprise ; relance avec échéance', () => {
    const base = { name: 'Jean', jobTitle: '', email: '', phone: '', accountId: '', notes: '' };
    expect(preparerContact({ ...base, name: ' ' }).ok).toBe(false);
    expect(preparerContact(base)).toEqual({
      ok: true,
      corps: {
        name: 'Jean',
        jobTitle: null,
        email: null,
        phone: null,
        accountId: null,
        notes: null,
      },
    });
    expect(
      preparerContact({ ...base, accountId: 'a1' }).ok &&
        preparerContact({ ...base, accountId: 'a1' }),
    ).toMatchObject({
      corps: { accountId: 'a1' },
    });
    expect(rattachementContact({ accountName: null, customerName: null, companyName: null })).toBe(
      'Sans entreprise',
    );
    expect(
      preparerActivite(
        { kind: 'call', subject: 'Appel', notes: '', echeance: '', assigneeUserId: 'u9' },
        null,
      ),
    ).toMatchObject({ ok: true, corps: { assigneeUserId: 'u9' } });
    expect(
      preparerActivite({ kind: 'follow_up', subject: 'Relancer', notes: '', echeance: '' }, null),
    ).toEqual({ ok: false, champs: { dueAt: 'Une relance a une échéance.' } });
    const note = preparerActivite(
      { kind: 'note', subject: 'N', notes: '', echeance: '2026-10-22' },
      'o1',
    );
    expect(note.ok && note.corps.dueAt).toBeNull();
  });

  it('erreurs : refus de rôle, code connu, lignes d’import', () => {
    expect(messageCrm({ status: 403 }, 'x')).toBe(
      'Votre rôle ne permet pas cette action sur le CRM.',
    );
    expect(messageCrm({ status: 409, detail: { code: 'CRM_STAGE_IN_USE' } }, 'x')).toMatch(
      /déplacez/,
    );
    expect(
      erreursImport({
        detail: { details: { errors: [{ line: 3, message: 'nom : Le nom est obligatoire.' }] } },
      }),
    ).toEqual(['Ligne 3 : nom : Le nom est obligatoire.']);
  });

  it('aucun calcul de montant dans la source', () => {
    const src = readFileSync(fileURLToPath(new URL('./crm-model.ts', import.meta.url)), 'utf8');
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toFixed/);
  });
});
