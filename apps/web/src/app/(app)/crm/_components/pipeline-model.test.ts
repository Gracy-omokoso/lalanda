// Pipeline v2 — ADR-0040 § 6 : Kanban au clavier, motif de perte obligatoire,
// prévision pondérée par devise recopiée du moteur.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatMontant } from '../../ventes/_components/sales-model';

import {
  annonceDepot,
  deplacable,
  filtreResponsableParDefaut,
  libelleMotif,
  libelleResponsable,
  lignesPrevision,
  motifsActifs,
  nomMembre,
  preparerMotif,
  requetePipeline,
  suiteDepot,
  toucheKanban,
} from './pipeline-model';

const ETAPES = [
  { key: 'lead', label: 'Lead', kind: 'open' as const },
  { key: 'nego', label: 'Négociation', kind: 'open' as const },
  { key: 'won', label: 'Gagné', kind: 'won' as const },
  { key: 'lost', label: 'Perdu', kind: 'lost' as const },
];
const O = { id: 'o1', title: 'Caisse', stageKey: 'lead' };
const MEMBRES = [{ userId: 'u1', name: 'Awa' }];

describe('Pipeline — Kanban au clavier', () => {
  it('Espace saisit, les flèches changent d’étape, Entrée dépose', () => {
    const r1 = toucheKanban(ETAPES, O, null, ' ');
    expect(r1.type).toBe('saisie');
    if (r1.type !== 'saisie') return;
    expect(r1.saisie).toEqual({ opportunityId: 'o1', origine: 'lead', cible: 'lead' });
    expect(r1.annonce).toMatch(/saisie dans Lead/);

    const r2 = toucheKanban(ETAPES, O, r1.saisie, 'ArrowRight');
    expect(r2).toMatchObject({ type: 'deplace', saisie: { cible: 'nego' } });
    if (r2.type !== 'deplace') return;
    expect(r2.annonce).toBe('Au-dessus de Négociation.');

    expect(toucheKanban(ETAPES, O, r2.saisie, 'Enter')).toEqual({
      type: 'depot',
      saisie: { opportunityId: 'o1', origine: 'lead', cible: 'nego' },
    });
  });

  it('bords, Échap, dépôt sur place, autre carte, touche sans effet', () => {
    const s = { opportunityId: 'o1', origine: 'lead', cible: 'lead' };
    expect(toucheKanban(ETAPES, O, s, 'ArrowLeft')).toEqual({ type: 'rien' });
    expect(toucheKanban(ETAPES, O, { ...s, cible: 'lost' }, 'ArrowRight')).toEqual({
      type: 'rien',
    });
    expect(toucheKanban(ETAPES, O, s, 'Escape').type).toBe('annule');
    expect(toucheKanban(ETAPES, O, s, 'Enter').type).toBe('annule');
    expect(toucheKanban(ETAPES, O, null, 'ArrowRight')).toEqual({ type: 'rien' });
    expect(toucheKanban(ETAPES, O, { ...s, opportunityId: 'autre' }, 'ArrowRight')).toEqual({
      type: 'rien',
    });
    expect(toucheKanban(ETAPES, O, s, 'a')).toEqual({ type: 'rien' });
  });

  it('suite du dépôt : motif en perdu, encadré en gagné, direct sinon', () => {
    expect(suiteDepot(ETAPES, 'lost')).toBe('motif');
    expect(suiteDepot(ETAPES, 'won')).toBe('gagne');
    expect(suiteDepot(ETAPES, 'nego')).toBe('direct');
    expect(annonceDepot('X', ETAPES, 'nego')).toBe('Opportunité X déplacée en Négociation.');
    expect(deplacable({ status: 'open' }, true)).toBe(true);
    expect(deplacable({ status: 'won' }, true)).toBe(false);
    expect(deplacable({ status: 'open' }, false)).toBe(false);
  });
});

describe('Pipeline — responsable et motifs', () => {
  it('nom du responsable, orpheline, membre illisible', () => {
    expect(nomMembre(MEMBRES, 'u1')).toBe('Awa');
    expect(nomMembre(MEMBRES, 'u2')).toBe('Un membre');
    expect(nomMembre(MEMBRES, null)).toBe('Personne');
    expect(libelleResponsable({ ownerId: 'u1', orphaned: false }, MEMBRES)).toBe(
      'Responsable : Awa',
    );
    expect(libelleResponsable({ ownerId: 'u9', orphaned: true }, MEMBRES)).toMatch(/réassigner/);
  });

  it('« Mes opportunités » : `ownerId=me` ; par défaut pour qui n’invite pas', () => {
    expect(requetePipeline('miennes')).toEqual({ ownerId: 'me' });
    expect(requetePipeline('tous')).toEqual({});
    expect(filtreResponsableParDefaut(['crm.read'])).toBe('miennes');
    expect(filtreResponsableParDefaut(['crm.read', 'members.invite'])).toBe('tous');
    expect(filtreResponsableParDefaut(null)).toBe('tous');
  });

  it('motif obligatoire au passage en perdu', () => {
    const motifs = [
      { key: 'price', label: 'Prix', active: true },
      { key: 'old', label: 'Ancien', active: false },
    ];
    expect(motifsActifs(motifs).map((m) => m.key)).toEqual(['price']);
    expect(libelleMotif(motifs, 'old')).toBe('Ancien');
    expect(libelleMotif(motifs, 'inconnu')).toBe('inconnu');
    expect(libelleMotif(motifs, null)).toBeNull();
    expect(preparerMotif({ key: '', detail: '' }, { lostReasonRequired: true }).ok).toBe(false);
    expect(preparerMotif({ key: '', detail: ' ' }, { lostReasonRequired: false })).toEqual({
      ok: true,
      corps: { lostReasonKey: null, lostReasonDetail: null },
    });
    expect(
      preparerMotif({ key: 'price', detail: ' trop cher ' }, { lostReasonRequired: true }),
    ).toEqual({ ok: true, corps: { lostReasonKey: 'price', lostReasonDetail: 'trop cher' } });
    expect(
      preparerMotif({ key: 'price', detail: 'x'.repeat(501) }, { lostReasonRequired: true }).ok,
    ).toBe(false);
  });
});

describe('Pipeline — prévision pondérée', () => {
  it('une ligne par devise, chiffres du moteur, part non pondérable à part', () => {
    const lignes = lignesPrevision({
      version: '1.1.0',
      basis: 'estimated',
      probabilitySource: 'historical',
      currencies: [
        {
          currency: 'CDF',
          weighted: '100000.00',
          unweighted: '250000.00',
          count: 2,
          notWeightable: { total: '0.00', count: 0 },
        },
        {
          currency: 'USD',
          weighted: '600.00',
          unweighted: '1500.00',
          count: 3,
          notWeightable: { total: '500.00', count: 1 },
        },
      ],
    });
    expect(lignes).toHaveLength(2);
    expect(lignes[0]).toEqual({
      currency: 'CDF',
      pondere: formatMontant('100000.00', 'CDF'),
      brut: formatMontant('250000.00', 'CDF'),
      detail: '2 opportunités ouvertes',
      nonPonderable: null,
    });
    expect(lignes[1]?.nonPonderable).toContain(formatMontant('500.00', 'USD'));
    expect(lignes[1]?.nonPonderable).toContain('1 opportunité sans');
  });

  it('aucun calcul de montant dans la source', () => {
    const src = readFileSync(
      fileURLToPath(new URL('./pipeline-model.ts', import.meta.url)),
      'utf8',
    );
    expect(src).not.toMatch(/parseFloat|Number\(|parseInt|toFixed/);
  });
});
