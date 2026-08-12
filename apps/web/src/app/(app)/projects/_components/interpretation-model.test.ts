// Tests de la logique pure des interprétations (S24a).

import { describe, expect, it } from 'vitest';

import type { LalaMessage } from '@/lib/api';

import {
  MAX_CARACTERES_QUESTION,
  MAX_MESSAGES_ECHANGE,
  cleInterpretation,
  etiquetteSource,
  historiqueBorne,
  messagesAEnvoyer,
  peutEnvoyer,
} from './interpretation-model';

describe('etiquetteSource — l’origine du texte est dite, jamais devinée', () => {
  it('un texte du modèle est annoncé comme tel', () => {
    expect(etiquetteSource('llm').texte).toBe('Rédigé par Lala');
  });

  it('un repli déterministe ne se fait PAS passer pour de l’IA', () => {
    const e = etiquetteSource('fallback');
    expect(e.texte).not.toMatch(/Lala/);
    expect(e.texte).toBe('Explication automatique');
    // L'infobulle nomme les deux causes possibles, sans en masquer une.
    expect(e.titre).toMatch(/indisponible/);
    expect(e.titre).toMatch(/écartée/);
  });
});

describe('historiqueBorne', () => {
  const fil = (n: number): LalaMessage[] =>
    Array.from({ length: n }, (_, i) => ({ role: 'user' as const, content: `q${i}` }));

  it('ne touche pas un fil déjà court', () => {
    expect(historiqueBorne(fil(3))).toHaveLength(3);
  });

  it('coupe par la gauche et garde les derniers échanges', () => {
    const borne = historiqueBorne(fil(25));
    expect(borne).toHaveLength(MAX_MESSAGES_ECHANGE);
    expect(borne[borne.length - 1]?.content).toBe('q24');
    expect(borne[0]?.content).toBe('q5');
  });

  it('un plafond nul ou négatif ne renvoie rien plutôt que tout', () => {
    expect(historiqueBorne(fil(5), 0)).toEqual([]);
    expect(historiqueBorne(fil(5), -1)).toEqual([]);
  });
});

describe('messagesAEnvoyer', () => {
  const historique: LalaMessage[] = [
    { role: 'user', content: 'Pourquoi rouge ?' },
    { role: 'assistant', content: 'Parce que le repère n’est pas atteint.' },
  ];

  it('le fil envoyé se termine TOUJOURS par la question de l’utilisateur', () => {
    const out = messagesAEnvoyer(historique, 'Et si j’allonge le prêt ?');
    expect(out?.[out.length - 1]).toEqual({
      role: 'user',
      content: 'Et si j’allonge le prêt ?',
    });
  });

  it('une question vide ou blanche n’envoie rien', () => {
    expect(messagesAEnvoyer(historique, '')).toBeNull();
    expect(messagesAEnvoyer(historique, '   \n ')).toBeNull();
  });

  it('la question est nettoyée et bornée en longueur', () => {
    const out = messagesAEnvoyer([], `  ${'x'.repeat(MAX_CARACTERES_QUESTION + 50)}  `);
    expect(out?.[0]?.content).toHaveLength(MAX_CARACTERES_QUESTION);
  });

  it('le fil reste borné même en ajoutant la question', () => {
    const long: LalaMessage[] = Array.from({ length: MAX_MESSAGES_ECHANGE + 5 }, () => ({
      role: 'user' as const,
      content: 'q',
    }));
    const out = messagesAEnvoyer(long, 'nouvelle');
    expect(out).toHaveLength(MAX_MESSAGES_ECHANGE);
    expect(out?.[out.length - 1]?.content).toBe('nouvelle');
  });
});

describe('peutEnvoyer', () => {
  it('refuse pendant un appel en cours et sur une question vide', () => {
    expect(peutEnvoyer('une question', false)).toBe(true);
    expect(peutEnvoyer('une question', true)).toBe(false);
    expect(peutEnvoyer('  ', false)).toBe(false);
  });
});

describe('cleInterpretation', () => {
  it('la valeur entre dans la clé : un recalcul invalide le cache', () => {
    expect(cleInterpretation('ratios', 'dscr', 0.82)).not.toBe(
      cleInterpretation('ratios', 'dscr', 1.4),
    );
  });

  it('deux lignes homonymes de feuilles différentes ne se confondent pas', () => {
    expect(cleInterpretation('ratios', 'x', 1)).not.toBe(cleInterpretation('bilan', 'x', 1));
  });
});
