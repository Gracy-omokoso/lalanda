// ADR-0074 — système de formulaires : logique pure et rendu accessible (serveur).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ChoiceCards, Checkbox, SegmentedControl, Switch } from './forms/choices';
import {
  DateMarksProvider,
  DatePicker,
  DateRangePicker,
  messageDate,
  useDateMarks,
} from './forms/date-picker';
import { EntityPicker } from './forms/entity-picker';
import { Field, FormGrid, PasswordInput, TextInput } from './forms/field';
import { ConfirmLeaveDialog, ErrorSummary, StickyActions, SubmitButton } from './forms/form-kit';
import { MoneyInput, PhoneInput } from './forms/inputs';
import {
  ajouterJours,
  ajouterMois,
  ajouterMoisCivils,
  ajouterRecent,
  aujourdhuiIso,
  avecRecherche,
  casesOtp,
  choisirDansPlage,
  correspondRecherche,
  dateRaccourci,
  deplacerJour,
  deplacerMoisClavier,
  describedBy,
  ecrireTelephone,
  effacerOtp,
  estRaccourciEnregistrer,
  FIELD_SPANS,
  finDeMois,
  formatDateFr,
  formatDateLongue,
  formatMoisCourt,
  formatMoisLong,
  grilleMois,
  grouperNational,
  idSur,
  indexerMarques,
  indexParLettre,
  jourSemaine,
  lireDateSaisie,
  lireMoisIso,
  lireMoisSaisi,
  moisActuel,
  navigationInterne,
  lireTelephone,
  phraseResume,
  prochainIndex,
  resumerErreurs,
  saisirOtp,
  surligner,
} from './forms/logic';
import {
  afficherMontant,
  curseurApresFormat,
  formaterSaisieMontant,
  valeurMontant,
} from './forms/money';
import { MonthPicker, messageMois } from './forms/month-picker';
import { OtpInput } from './forms/otp-input';
import { placerPopover } from './forms/popover';
import { Select } from './forms/select';

const rendre = (el: React.ReactElement): string => renderToStaticMarkup(el);

describe('largeurs sémantiques', () => {
  it('une colonne sous 32 rem, puis la largeur de la donnée', () => {
    for (const t of ['xs', 'sm', 'md', 'lg', 'full'] as const) {
      expect(FIELD_SPANS[t]).toMatch(/^col-span-full/);
    }
    expect(FIELD_SPANS.xs).toContain('@3xl:col-span-2');
    expect(FIELD_SPANS.sm).toContain('@3xl:col-span-3');
    expect(FIELD_SPANS.md).toContain('@3xl:col-span-4');
    expect(FIELD_SPANS.lg).toContain('@3xl:col-span-6');
    expect(FIELD_SPANS.full).toBe('col-span-full');
  });

  it('describedBy relie aide puis erreur, rien sans elles', () => {
    expect(describedBy('x', {})).toBeUndefined();
    expect(describedBy('x', { hint: 'a', error: 'b' })).toBe('x-aide x-erreur');
    expect(describedBy('x', { error: 'b', extra: ['y', null] })).toBe('x-erreur y');
  });

  it('idSur retire les caractères de useId', () => {
    expect(idSur('«r1»')).toBe('fr1');
    expect(idSur(':r2:', 'champ')).toBe('champr2');
  });
});

describe('dates', () => {
  const ref = '2026-11-11';

  it('lit les saisies tolérantes', () => {
    expect(lireDateSaisie('11/11/2026', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('1/2/26', ref)).toBe('2026-02-01');
    expect(lireDateSaisie('11.11.2026', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('11-11-26', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('11 11 2026', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('11112026', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('111126', ref)).toBe('2026-11-11');
    expect(lireDateSaisie('3/4', ref)).toBe('2026-04-03');
    expect(lireDateSaisie('2026-11-11', ref)).toBe('2026-11-11');
  });

  it('refuse une date qui n’existe pas', () => {
    expect(lireDateSaisie('31/02/2026', ref)).toBeNull();
    expect(lireDateSaisie('29/02/2027', ref)).toBeNull();
    expect(lireDateSaisie('29/02/2028', ref)).toBe('2028-02-29');
    expect(lireDateSaisie('demain', ref)).toBeNull();
    expect(lireDateSaisie('', ref)).toBeNull();
  });

  it('formate en JJ/MM/AAAA et en toutes lettres', () => {
    expect(formatDateFr('2026-11-01')).toBe('01/11/2026');
    expect(formatDateFr('')).toBe('');
    expect(formatDateLongue('2026-11-11')).toBe('mercredi 11 novembre 2026');
    expect(formatDateLongue('2026-11-01')).toBe('dimanche 1er novembre 2026');
  });

  it('lundi premier jour, six semaines', () => {
    expect(jourSemaine('2026-11-09')).toBe(0);
    expect(jourSemaine('2026-11-15')).toBe(6);
    const g = grilleMois(2026, 11);
    expect(g).toHaveLength(6);
    expect(g[0]![0]!.iso).toBe('2026-10-26');
    expect(g[0]![6]!.iso).toBe('2026-11-01');
    expect(g[0]![6]!.duMois).toBe(true);
    expect(g[0]![0]!.duMois).toBe(false);
  });

  it('arithmétique de calendrier', () => {
    expect(ajouterJours('2026-12-31', 1)).toBe('2027-01-01');
    expect(ajouterMois('2026-01-31', 1)).toBe('2026-02-28');
    expect(ajouterMois('2026-01-15', -2)).toBe('2025-11-15');
    expect(finDeMois('2028-02-10')).toBe('2028-02-29');
  });

  it('clavier du calendrier (WAI-ARIA)', () => {
    expect(deplacerJour('2026-11-11', 'ArrowRight')).toBe('2026-11-12');
    expect(deplacerJour('2026-11-11', 'ArrowUp')).toBe('2026-11-04');
    expect(deplacerJour('2026-11-11', 'Home')).toBe('2026-11-09');
    expect(deplacerJour('2026-11-11', 'End')).toBe('2026-11-15');
    expect(deplacerJour('2026-11-11', 'PageDown')).toBe('2026-12-11');
    expect(deplacerJour('2026-11-11', 'PageUp', true)).toBe('2025-11-11');
    expect(deplacerJour('2026-11-11', 'a')).toBeNull();
  });

  it('raccourcis', () => {
    expect(dateRaccourci('today', ref)).toBe(ref);
    expect(dateRaccourci('endOfMonth', ref)).toBe('2026-11-30');
    expect(dateRaccourci('plus30', ref)).toBe('2026-12-11');
    expect(dateRaccourci('endOfYear', ref)).toBe('2026-12-31');
  });

  it('date du jour dans le fuseau local', () => {
    expect(aujourdhuiIso(new Date(2026, 10, 11, 23, 30))).toBe('2026-11-11');
  });

  it('bornes : message clair', () => {
    expect(messageDate('', '2026-01-01')).toBeNull();
    expect(messageDate('32/01/2026')).toMatch(/JJ\/MM\/AAAA/);
    expect(messageDate('01/01/2025', '2026-01-01')).toBe(
      'La date ne peut pas précéder le 01/01/2026.',
    );
    expect(messageDate('01/01/2027', undefined, '2026-12-31')).toMatch(/dépasser le 31\/12\/2026/);
  });

  it('plage : deux clics, dans l’ordre voulu', () => {
    const a = choisirDansPlage({ start: '', end: '' }, '2026-11-20');
    expect(a).toEqual({ start: '2026-11-20', end: '' });
    expect(choisirDansPlage(a, '2026-11-10')).toEqual({ start: '2026-11-10', end: '2026-11-20' });
    expect(choisirDansPlage({ start: '2026-11-10', end: '2026-11-20' }, '2026-12-01')).toEqual({
      start: '2026-12-01',
      end: '',
    });
  });
});

describe('code à usage unique', () => {
  const vide = casesOtp('', 6);

  it('un chiffre avance d’une case', () => {
    const e = saisirOtp(vide, 0, '4');
    expect(e.cases.join('')).toBe('4');
    expect(e.focus).toBe(1);
    expect(e.complet).toBe(false);
  });

  it('le code collé remplit tout et se déclare complet', () => {
    const e = saisirOtp(vide, 3, '123 456');
    expect(e.cases).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(e.complet).toBe(true);
    expect(e.focus).toBe(5);
  });

  it('un collage partiel remplit depuis la case', () => {
    expect(saisirOtp(vide, 2, '98').cases).toEqual(['', '', '9', '8', '', '']);
  });

  it('les lettres sont ignorées', () => {
    expect(saisirOtp(vide, 0, 'a').cases).toEqual(vide);
  });

  it('retour arrière : vide puis recule', () => {
    const plein = casesOtp('123', 6);
    expect(effacerOtp(plein, 2)).toMatchObject({ focus: 2, cases: ['1', '2', '', '', '', ''] });
    expect(effacerOtp(plein, 3)).toMatchObject({ focus: 2, cases: ['1', '2', '', '', '', ''] });
    expect(effacerOtp(casesOtp('', 6), 0).focus).toBe(0);
  });
});

describe('recherche', () => {
  it('sans accents ni casse', () => {
    expect(correspondRecherche(['Société Générale'], 'societe')).toBe(true);
    expect(correspondRecherche(['Kinshasa', null], 'KIN')).toBe(true);
    expect(correspondRecherche(['Lubumbashi'], 'goma')).toBe(false);
    expect(correspondRecherche(['x'], '  ')).toBe(true);
  });

  it('surligne la correspondance, accents compris', () => {
    expect(surligner('Société Générale', 'gene')).toEqual([
      { texte: 'Société ', correspond: false },
      { texte: 'Géné', correspond: true },
      { texte: 'rale', correspond: false },
    ]);
    expect(surligner('Abc', '')).toEqual([{ texte: 'Abc', correspond: false }]);
    expect(surligner('Abc', 'z')).toEqual([{ texte: 'Abc', correspond: false }]);
  });

  it('recherche dans la liste dès 8 options', () => {
    expect(avecRecherche(7)).toBe(false);
    expect(avecRecherche(8)).toBe(true);
    expect(avecRecherche(3, true)).toBe(true);
  });

  it('navigation : options désactivées sautées, pas de bouclage', () => {
    const a = [true, false, true, true];
    expect(prochainIndex(a, -1, 'ArrowDown')).toBe(0);
    expect(prochainIndex(a, 0, 'ArrowDown')).toBe(2);
    expect(prochainIndex(a, 3, 'ArrowDown')).toBe(3);
    expect(prochainIndex(a, 2, 'ArrowUp')).toBe(0);
    expect(prochainIndex(a, 2, 'Home')).toBe(0);
    expect(prochainIndex(a, 0, 'End')).toBe(3);
    expect(prochainIndex(a, 0, 'x')).toBeNull();
    expect(prochainIndex([], 0, 'ArrowDown')).toBeNull();
  });

  it('recherche par lettre', () => {
    const l = ['Banque', 'Caisse', 'Coffre'];
    expect(indexParLettre(l, [true, true, true], 0, 'c')).toBe(1);
    expect(indexParLettre(l, [true, true, true], 1, 'c')).toBe(2);
    expect(indexParLettre(l, [true, false, true], 0, 'c')).toBe(2);
  });

  it('récents : en tête, sans doublon, bornés', () => {
    const k = (x: { id: string }): string => x.id;
    let r = ajouterRecent([], { id: 'a' }, k, 2);
    r = ajouterRecent(r, { id: 'b' }, k, 2);
    r = ajouterRecent(r, { id: 'a' }, k, 2);
    expect(r.map(k)).toEqual(['a', 'b']);
    expect(ajouterRecent(r, { id: 'c' }, k, 2).map(k)).toEqual(['c', 'a']);
  });
});

describe('formulaire', () => {
  it('Cmd ou Ctrl + Entrée', () => {
    expect(estRaccourciEnregistrer({ key: 'Enter', metaKey: true })).toBe(true);
    expect(estRaccourciEnregistrer({ key: 'Enter', ctrlKey: true })).toBe(true);
    expect(estRaccourciEnregistrer({ key: 'Enter' })).toBe(false);
    expect(estRaccourciEnregistrer({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('résumé d’erreurs dans l’ordre des champs, inconnues à la fin', () => {
    const r = resumerErreurs({ b: 'B faux', a: 'A faux', autre: 'Refus serveur' }, [
      { cle: 'a', id: 'champ-a', libelle: 'A' },
      { cle: 'b', id: 'champ-b', libelle: 'B' },
    ]);
    expect(r.map((e) => e.id)).toEqual(['champ-a', 'champ-b', '']);
    expect(r[2]!.message).toBe('Refus serveur');
    expect(phraseResume(1)).toBe('Un champ est à corriger.');
    expect(phraseResume(3)).toBe('3 champs sont à corriger.');
  });

  it('liste ouverte 6 px sous le champ, ou au-dessus faute de place', () => {
    const dessous = placerPopover(
      { top: 100, bottom: 136, left: 20, width: 200 },
      { width: 1000, height: 800 },
      300,
    );
    expect(dessous).toMatchObject({ top: 142, left: 20, dessus: false, maxHeight: 300 });
    const dessus = placerPopover(
      { top: 700, bottom: 736, left: 950, width: 200 },
      { width: 1000, height: 800 },
      300,
    );
    expect(dessus.dessus).toBe(true);
    // Collée au-dessus du champ, quelle que soit la hauteur réelle de la liste.
    expect(dessus.top).toBeNull();
    expect(dessus.bottom).toBe(800 - 700 + 6);
    expect(dessus.left).toBe(1000 - 200 - 8);
  });
});

describe('téléphone', () => {
  it('+243 par défaut, 0 de tête retiré, groupé', () => {
    expect(lireTelephone('0812345678')).toEqual({ indicatif: '+243', national: '812345678' });
    expect(lireTelephone('00243 81 234 5678')).toEqual({
      indicatif: '+243',
      national: '812345678',
    });
    expect(lireTelephone('+33 6 12 34 56 78')).toEqual({ indicatif: '+33', national: '612345678' });
    expect(grouperNational('+243', '812345678')).toBe('81 234 5678');
    expect(ecrireTelephone('+243', '0812345678')).toBe('+243 81 234 5678');
    expect(ecrireTelephone('+243', '')).toBe('');
  });
});

describe('montants : du texte seulement (ADR-0025)', () => {
  it('séparateurs français à la saisie', () => {
    expect(formaterSaisieMontant('1234567,5')).toBe('1 234 567,5');
    expect(formaterSaisieMontant('1234567.50')).toBe('1 234 567,50');
    expect(formaterSaisieMontant('12,345')).toBe('12,34');
    expect(formaterSaisieMontant('0012')).toBe('12');
    expect(formaterSaisieMontant(',5')).toBe('0,5');
    expect(formaterSaisieMontant('-5')).toBe('5');
    expect(formaterSaisieMontant('-5', { negatif: true })).toBe('-5');
    expect(formaterSaisieMontant('1500,5', { decimales: 0 })).toBe('1 500');
    expect(formaterSaisieMontant('abc')).toBe('');
  });

  it('valeur transmise en chaîne décimale, et retour à l’affichage', () => {
    expect(valeurMontant('1 234 567,50')).toBe('1234567.50');
    expect(valeurMontant('12,')).toBe('12');
    expect(valeurMontant('')).toBe('');
    expect(afficherMontant('2500.75')).toBe('2 500,75');
    expect(afficherMontant('')).toBe('');
  });

  it('le curseur garde sa place après reformatage', () => {
    // « 12345| » devient « 12 345| ».
    expect(curseurApresFormat('12345', 5, '12 345')).toBe(6);
    // « 1|2345 » : après le premier chiffre.
    expect(curseurApresFormat('12345', 1, '12 345')).toBe(1);
  });

  it('money.ts ne convertit ni ne calcule rien', () => {
    const source = readFileSync(fileURLToPath(new URL('./forms/money.ts', import.meta.url)), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(source).not.toMatch(/\bNumber\s*\(|\bparseFloat\b|\bparseInt\b|\.toFixed\s*\(|\bMath\./);
    expect(source).not.toMatch(/[=(,]\s*\+[a-zA-Z_]/);
  });
});

describe('rendu accessible', () => {
  it('Field relie libellé, aide, erreur, obligatoire', () => {
    const html = rendre(
      h(
        Field,
        { id: 'nom', label: 'Nom', hint: 'Tel qu’au RCCM', error: 'Obligatoire', required: true },
        h(TextInput, { value: '', onChange: () => undefined }),
      ),
    );
    expect(html).toContain('for="nom"');
    expect(html).toContain('id="nom"');
    expect(html).toContain('aria-describedby="nom-aide nom-erreur"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('(obligatoire)');
    expect(html).toContain('id="nom-erreur"');
  });

  it('Field facultatif et grille à requêtes de conteneur', () => {
    const html = rendre(
      h(
        FormGrid,
        null,
        h(Field, { label: 'Code postal', size: 'xs', optional: true }, h(TextInput, {})),
      ),
    );
    expect(html).toContain('@container');
    expect(html).toContain('@lg:grid-cols-12');
    expect(html).toContain('Facultatif');
    expect(html).toContain('@3xl:col-span-2');
  });

  it('mot de passe masqué, bouton « Afficher » à bascule', () => {
    const html = rendre(h(PasswordInput, { 'aria-label': 'Mot de passe' }));
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Afficher le mot de passe');
  });

  it('Select : combobox fermé, chevron avec sa marge', () => {
    const html = rendre(
      h(
        Field,
        { id: 'devise', label: 'Devise' },
        h(Select, {
          value: 'USD',
          onChange: () => undefined,
          options: [
            { value: 'USD', label: 'Dollar américain' },
            { value: 'CDF', label: 'Franc congolais' },
          ],
        }),
      ),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('id="devise"');
    expect(html).toContain('pr-10');
    expect(html).toContain('right-3');
    expect(html).toContain('Dollar américain');
  });

  it('EntityPicker : combobox éditable, bouton « + » nommé', () => {
    const html = rendre(
      h(EntityPicker<{ id: string; nom: string }>, {
        'aria-label': 'Client',
        value: { id: '1', nom: 'Exemple SARL' },
        onChange: () => undefined,
        search: async () => [],
        getKey: (c) => c.id,
        getLabel: (c) => c.nom,
        getDescription: () => 'NIF A1234567B',
        createForm: () => null,
        createButtonLabel: 'Créer un client',
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('value="Exemple SARL"');
    expect(html).toContain('aria-label="Créer un client"');
    expect(html).toContain('NIF A1234567B');
    expect(html).toContain('Effacer le choix « Exemple SARL »');
  });

  it('OtpInput : six cases, remplissage automatique, clavier numérique', () => {
    const html = rendre(
      h(OtpInput, { value: '12', onChange: () => undefined, 'aria-label': 'Code' }),
    );
    expect(html.match(/<input/g)).toHaveLength(6);
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('aria-label="Chiffre 1 sur 6"');
    expect(html).toContain('role="group"');
  });

  it('DatePicker et DateRangePicker : saisie JJ/MM/AAAA, bouton calendrier', () => {
    const d = rendre(h(DatePicker, { value: '2026-11-11', onChange: () => undefined }));
    expect(d).toContain('value="11/11/2026"');
    expect(d).toContain('aria-haspopup="dialog"');
    expect(d).toContain('mercredi 11 novembre 2026');
    const p = rendre(
      h(DateRangePicker, {
        value: { start: '2026-11-01', end: '2026-11-30' },
        onChange: () => undefined,
      }),
    );
    expect(p).toContain('value="01/11/2026"');
    expect(p).toContain('value="30/11/2026"');
  });

  it('SegmentedControl et ChoiceCards : radiogroup, un seul arrêt de tabulation', () => {
    const s = rendre(
      h(SegmentedControl<'ttc' | 'ht'>, {
        'aria-label': 'Mode de prix',
        value: 'ht',
        onChange: () => undefined,
        options: [
          { value: 'ttc', label: 'TTC' },
          { value: 'ht', label: 'HT' },
        ],
      }),
    );
    expect(s).toContain('role="radiogroup"');
    expect(s.match(/role="radio"/g)).toHaveLength(2);
    expect(s.match(/tabindex="0"/g)).toHaveLength(1);
    expect(s).toContain('aria-checked="true"');
    const c = rendre(
      h(ChoiceCards<'PP' | 'PM'>, {
        'aria-label': 'Type',
        value: '',
        onChange: () => undefined,
        options: [
          { value: 'PP', label: 'Personne physique', description: 'Un particulier.' },
          { value: 'PM', label: 'Personne morale', description: 'Une société.' },
        ],
      }),
    );
    expect(c.match(/tabindex="0"/g)).toHaveLength(1);
    expect(c).toContain('Une société.');
  });

  it('Switch et Checkbox', () => {
    const s = rendre(h(Switch, { checked: true, onChange: () => undefined, label: 'Inviter' }));
    expect(s).toContain('role="switch"');
    expect(s).toContain('aria-checked="true"');
    const c = rendre(
      h(Checkbox, { checked: false, onChange: () => undefined, label: 'J’accepte' }),
    );
    expect(c).toContain('type="checkbox"');
    expect(c).toContain('J’accepte');
  });

  it('MoneyInput et PhoneInput', () => {
    const m = rendre(
      h(MoneyInput, {
        value: '1500.5',
        onChange: () => undefined,
        currency: 'USD',
        'aria-label': 'Montant',
      }),
    );
    expect(m).toContain('value="1 500,5"');
    expect(m).toContain('inputMode="decimal"');
    expect(m).toContain('USD');
    const p = rendre(h(PhoneInput, { value: '+243 81 234 5678', onChange: () => undefined }));
    expect(p).toContain('value="81 234 5678"');
    expect(p).toContain('+243');
  });

  it('SubmitButton, StickyActions, ErrorSummary', () => {
    const b = rendre(h(SubmitButton, { busy: true, busyLabel: 'Enregistrement…' }, 'Enregistrer'));
    expect(b).toContain('type="submit"');
    expect(b).toContain('aria-busy="true"');
    expect(b).toContain('Enregistrement…');
    expect(rendre(h(StickyActions, { status: 'Modifié' }, 'x'))).toContain('sticky bottom-0');
    expect(rendre(h(ErrorSummary, { errors: [] }))).toBe('');
    const e = rendre(
      h(ErrorSummary, { errors: [{ id: 'nom', libelle: 'Nom', message: 'Obligatoire.' }] }),
    );
    expect(e).toContain('role="alert"');
    expect(e).toContain('href="#nom"');
  });
});

describe('mois (MonthPicker, décision n° 6)', () => {
  const ref = '2026-11';

  it('valeur AAAA-MM, celle du champ natif type="month"', () => {
    expect(lireMoisIso('2026-11')).toEqual({ annee: 2026, mois: 11 });
    expect(lireMoisIso('2026-13')).toBeNull();
    expect(lireMoisIso('2026-1')).toBeNull();
    expect(lireMoisIso('')).toBeNull();
    expect(moisActuel(new Date(2026, 10, 30, 23, 30))).toBe('2026-11');
  });

  it('lit les saisies tolérantes', () => {
    expect(lireMoisSaisi('2026-11', ref)).toBe('2026-11');
    expect(lireMoisSaisi('2026-3', ref)).toBe('2026-03');
    expect(lireMoisSaisi('11/2026', ref)).toBe('2026-11');
    expect(lireMoisSaisi('3-27', ref)).toBe('2027-03');
    expect(lireMoisSaisi('11.2026', ref)).toBe('2026-11');
    expect(lireMoisSaisi('11 2026', ref)).toBe('2026-11');
    expect(lireMoisSaisi('112026', ref)).toBe('2026-11');
    expect(lireMoisSaisi('4', ref)).toBe('2026-04');
    expect(lireMoisSaisi('nov. 2026', ref)).toBe('2026-11');
    expect(lireMoisSaisi('Novembre 27', ref)).toBe('2027-11');
    expect(lireMoisSaisi('fevrier 2026', ref)).toBe('2026-02');
    expect(lireMoisSaisi('févr.', ref)).toBe('2026-02');
    expect(lireMoisSaisi('août 2025', ref)).toBe('2025-08');
    expect(lireMoisSaisi('juin', ref)).toBe('2026-06');
    expect(lireMoisSaisi('juil 2026', ref)).toBe('2026-07');
  });

  it('refuse ce qui ne se lit pas', () => {
    expect(lireMoisSaisi('13/2026', ref)).toBeNull();
    expect(lireMoisSaisi('0/2026', ref)).toBeNull();
    expect(lireMoisSaisi('ju 2026', ref)).toBeNull();
    expect(lireMoisSaisi('jui', ref)).toBeNull();
    expect(lireMoisSaisi('bientôt', ref)).toBeNull();
    expect(lireMoisSaisi('', ref)).toBeNull();
  });

  it('affiche « nov. 2026 » et nomme « novembre 2026 »', () => {
    expect(formatMoisCourt('2026-11')).toBe('nov. 2026');
    expect(formatMoisCourt('2026-05')).toBe('mai 2026');
    expect(formatMoisCourt('')).toBe('');
    expect(formatMoisLong('2026-02')).toBe('février 2026');
  });

  it('arithmétique et clavier de la grille (3 × 4)', () => {
    expect(ajouterMoisCivils('2026-12', 1)).toBe('2027-01');
    expect(ajouterMoisCivils('2026-01', -1)).toBe('2025-12');
    expect(deplacerMoisClavier('2026-11', 'ArrowRight')).toBe('2026-12');
    expect(deplacerMoisClavier('2026-11', 'ArrowUp')).toBe('2026-08');
    expect(deplacerMoisClavier('2026-11', 'ArrowDown')).toBe('2027-02');
    expect(deplacerMoisClavier('2026-11', 'Home')).toBe('2026-01');
    expect(deplacerMoisClavier('2026-11', 'End')).toBe('2026-12');
    expect(deplacerMoisClavier('2026-11', 'PageUp')).toBe('2025-11');
    expect(deplacerMoisClavier('2026-11', 'PageDown')).toBe('2027-11');
    expect(deplacerMoisClavier('2026-11', 'a')).toBeNull();
  });

  it('bornes min/max : message clair', () => {
    expect(messageMois('', '2026-01')).toBeNull();
    expect(messageMois('13/2026')).toMatch(/MM\/AAAA/);
    expect(messageMois('12/2025', '2026-01')).toBe('Le mois ne peut pas précéder janvier 2026.');
    expect(messageMois('01/2027', undefined, '2026-12')).toBe(
      'Le mois ne peut pas dépasser décembre 2026.',
    );
  });

  it('rendu : champ texte « nov. 2026 », bouton de grille, relié au Field', () => {
    const m = rendre(h(MonthPicker, { value: '2026-11', onChange: () => undefined }));
    expect(m).toContain('value="nov. 2026"');
    expect(m).toContain('placeholder="MM/AAAA"');
    expect(m).toContain('aria-haspopup="dialog"');
    expect(m).toContain('aria-label="Changer le mois, novembre 2026"');
    const vide = rendre(
      h(MonthPicker, { value: '', onChange: () => undefined, 'aria-label': 'Mois' }),
    );
    expect(vide).toContain('value=""');
    expect(vide).toContain('aria-label="Choisir un mois"');
    const champ = rendre(
      h(
        Field,
        { label: 'Mois', id: 'm' },
        h(MonthPicker, { value: '', onChange: () => undefined }),
      ),
    );
    expect(champ).toContain('id="m"');
    expect(champ).toContain('for="m"');
  });
});

describe('jours marqués (fériés, décision n° 1)', () => {
  it('date précise, jour récurrent, noms joints, jamais d’invention', () => {
    const nom = indexerMarques([
      { date: '2026-06-30', label: 'Indépendance' },
      { date: '2024-05-01', label: 'Fête du travail', recurring: true },
      { date: '2026-05-01', label: 'Fermeture' },
      { date: '2026-12-25', label: 'Noël' },
      { date: '2026-12-25', label: 'Fermeture annuelle' },
      { date: '2026-02-31', label: 'Invalide' },
      { date: '2026-03-01', label: '  ' },
    ]);
    expect(nom('2026-06-30')).toBe('Indépendance');
    expect(nom('2027-06-30')).toBeUndefined();
    expect(nom('2031-05-01')).toBe('Fête du travail');
    expect(nom('2026-05-01')).toBe('Fermeture');
    expect(nom('2026-12-25')).toBe('Noël · Fermeture annuelle');
    expect(nom('2026-03-01')).toBeUndefined();
    expect(nom('2026-11-11')).toBeUndefined();
    expect(indexerMarques(null)('2026-01-01')).toBeUndefined();
  });

  it('DateMarksProvider : transmis aux sélecteurs, sans rien changer au champ', () => {
    let lu: unknown = 'non lu';
    const Sonde = (): null => {
      lu = useDateMarks();
      return null;
    };
    rendre(h(Sonde));
    expect(lu).toBeNull();
    const marks = [{ date: '2026-06-30', label: 'Indépendance' }];
    const html = rendre(
      h(
        DateMarksProvider,
        { marks },
        h(Sonde),
        h(DatePicker, { value: '2026-06-30', onChange: () => undefined }),
      ),
    );
    expect(lu).toBe(marks);
    // Valeur inchangée : le férié n'est qu'une indication.
    expect(html).toContain('value="30/06/2026"');
  });

  it('le sélecteur de date ne cite aucun férié en dur et n’appelle aucune API', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./forms/date-picker.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(source).not.toMatch(/fetch\(|\/hr\/holidays/);
  });
});

describe('garde de navigation interne (décision n° 3)', () => {
  const ici = 'https://app.lalanda.cd/ventes/clients/nouveau';
  const clic = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  const lien = (
    href: string,
    extra: Partial<{ target: string; hasDownload: boolean }> = {},
  ): { href: string; target: string; hasDownload: boolean } => ({
    href,
    target: '',
    hasDownload: false,
    ...extra,
  });

  it('retient un lien interne de l’application', () => {
    expect(navigationInterne(clic, lien('/ventes/factures'), ici)).toBe(
      'https://app.lalanda.cd/ventes/factures',
    );
    expect(navigationInterne(clic, lien('https://app.lalanda.cd/rh?vue=liste'), ici)).toBe(
      'https://app.lalanda.cd/rh?vue=liste',
    );
    expect(navigationInterne(clic, lien('/ventes/clients/nouveau?etape=2'), ici)).not.toBeNull();
    expect(navigationInterne(clic, lien('/accueil', { target: '_self' }), ici)).not.toBeNull();
  });

  it('laisse passer nouvel onglet, téléchargement, autre site, ancre, clic déjà traité', () => {
    expect(navigationInterne({ ...clic, metaKey: true }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne({ ...clic, ctrlKey: true }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne({ ...clic, shiftKey: true }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne({ ...clic, altKey: true }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne({ ...clic, button: 1 }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne({ ...clic, defaultPrevented: true }, lien('/rh'), ici)).toBeNull();
    expect(navigationInterne(clic, lien('/rh', { target: '_blank' }), ici)).toBeNull();
    expect(navigationInterne(clic, lien('/export.csv', { hasDownload: true }), ici)).toBeNull();
    expect(navigationInterne(clic, lien('https://dgi.gouv.cd/'), ici)).toBeNull();
    expect(navigationInterne(clic, lien('mailto:contact@lalanda.cd'), ici)).toBeNull();
    expect(navigationInterne(clic, lien('tel:+243812345678'), ici)).toBeNull();
    expect(navigationInterne(clic, lien('#adresse'), ici)).toBeNull();
    expect(navigationInterne(clic, lien('/rh'), 'pas une adresse')).toBeNull();
  });

  it('fenêtre « Quitter sans enregistrer ? » : Rester et Quitter', () => {
    const html = rendre(
      h(ConfirmLeaveDialog, { onStay: () => undefined, onLeave: () => undefined }),
    );
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('Quitter sans enregistrer ?');
    expect(html).toContain('>Rester<');
    expect(html).toContain('>Quitter<');
    expect(html).not.toContain('type="submit"');
  });
});

describe('case à cocher : alignée sur la première ligne du libellé', () => {
  it('la case ne se centre pas sur un libellé de plusieurs lignes', () => {
    const html = rendre(
      h(Checkbox, {
        checked: false,
        onChange: () => undefined,
        label:
          'J’accepte les conditions générales d’utilisation et la politique de confidentialité',
      }),
    );
    const conteneur = /<div class="([^"]+)"/.exec(html)![1]!;
    expect(conteneur).toContain('items-start');
    expect(conteneur).not.toContain('items-center');
    // Boîte de la hauteur d'une ligne du libellé (20 px, `leading-5`), case centrée dedans.
    expect(html).toMatch(/data-alignement="premiere-ligne" class="[^"]*\bh-5\b[^"]*items-center/);
    expect(html).toMatch(/<label[^>]*class="[^"]*leading-5/);
  });
});
