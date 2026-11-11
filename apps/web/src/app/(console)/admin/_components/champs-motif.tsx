'use client';

// Champs du motif d'un geste de la console (ADR-0053 — P2) : catégorie, message destiné
// au client (il paraît dans SON journal, sous « Équipe Lalanda »), note interne (jamais
// montrée au client).
//
// ADR-0074 : catégorie en `Select`, textes en `TextArea`, chacun relié à son libellé par
// `Field`. Mêmes limites (500 et 1 000 caractères), même contrôle `motifComplet` côté
// appelant : le bouton reste désactivé tant que le motif n'est pas complet.

import { Field, FormGrid, Select, TextArea } from '@lalanda/ui';

import { CATEGORIES_MOTIF, NOTE_INTERNE_MIN, type MotifSaisi } from './motif-model';

const OPTIONS_CATEGORIE = CATEGORIES_MOTIF.map((c) => ({ value: c.valeur, label: c.libelle }));

export function ChampsMotif({
  motif,
  onChange,
  avecCategorie,
  avecMessageClient,
  libelleMessageClient = 'Message destiné au client',
}: {
  motif: MotifSaisi;
  onChange: (m: MotifSaisi) => void;
  avecCategorie: boolean;
  avecMessageClient: boolean;
  libelleMessageClient?: string;
}): React.ReactElement {
  return (
    <FormGrid className="max-w-xl">
      {avecCategorie ? (
        <Field label="Catégorie de motif" required size="md">
          <Select<MotifSaisi['reasonCategory']>
            value={motif.reasonCategory}
            onChange={(v) => onChange({ ...motif, reasonCategory: v })}
            options={OPTIONS_CATEGORIE}
            placeholder="Choisir…"
          />
        </Field>
      ) : null}
      {avecMessageClient ? (
        <Field label={libelleMessageClient} required size="full" newRow>
          <TextArea
            value={motif.clientMessage}
            onChange={(e) => onChange({ ...motif, clientMessage: e.target.value })}
            rows={2}
            maxLength={500}
          />
        </Field>
      ) : null}
      <Field
        label="Note interne"
        required
        size="full"
        newRow
        hint={`${NOTE_INTERNE_MIN} caractères minimum, jamais montrée au client.`}
      >
        <TextArea
          value={motif.internalNote}
          onChange={(e) => onChange({ ...motif, internalNote: e.target.value })}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </FormGrid>
  );
}
