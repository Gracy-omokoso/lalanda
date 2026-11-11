'use client';

// Emplacements — ADR-0046 § 2.2 : entrepôts, magasins, véhicules, chantiers.
// Liste en cartes ; création et modification en fenêtre modale (`stock.manage`).

import {
  Badge,
  Field,
  FormGrid,
  Modal,
  Select,
  SubmitButton,
  TextInput,
  buttonClasses,
} from '@lalanda/ui';
import { MapPin, Plus, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';

import { stockApi, type StockLocationView } from '@/lib/api-stock';

import { ChoixMembre } from '../../crm/_components/crm-ui';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import {
  formulaireEmplacement,
  gestesEmplacement,
  preparerEmplacement,
  type FormulaireEmplacement,
} from './emplacements-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_TYPE_EMPLACEMENT,
  STOCKS_BASE,
  messageStocks,
  nomPersonne,
  peutGererStocks,
} from './stocks-model';
import { Bandeau, CarteVide, Chargement, EchecLecture } from './stocks-ui';

function FormulaireEmplacementVue({
  emplacement,
  onFait,
  onSale,
}: {
  emplacement: StockLocationView | null;
  onFait: () => void;
  onSale: (s: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { membres } = useAccesStocks();
  const [f, setF] = useState<FormulaireEmplacement>(() => formulaireEmplacement(emplacement));
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormulaireEmplacement>): void => {
    setF((x) => ({ ...x, ...p }));
    onSale(true);
  };

  async function enregistrer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerEmplacement(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      if (emplacement === null) await stockApi.createLocation(p.corps);
      else {
        await stockApi.updateLocation(emplacement.id, {
          ...p.corps,
          expectedRevision: emplacement.revision,
        });
      }
      onFait();
    } catch (err) {
      setErreur(messageStocks(err, 'Enregistrement impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void enregistrer(e)} className="flex flex-col gap-4">
      <FormGrid>
        <Field id={`${id}-nom`} label="Nom" required size="lg" error={champs['name']}>
          <TextInput
            value={f.name}
            maxLength={120}
            placeholder="Chantier Gombe"
            autoFocus={emplacement === null}
            onChange={(e) => maj({ name: e.target.value })}
          />
        </Field>
        <Field id={`${id}-type`} label="Type" size="md">
          <Select<FormulaireEmplacement['kind']>
            value={f.kind}
            onChange={(v) => maj({ kind: v })}
            options={Object.entries(LIBELLES_TYPE_EMPLACEMENT).map(([k, l]) => ({
              value: k as FormulaireEmplacement['kind'],
              label: l,
            }))}
          />
        </Field>
        <Field id={`${id}-adresse`} label="Adresse" size="full" error={champs['address']}>
          <TextInput
            value={f.address}
            maxLength={300}
            onChange={(e) => maj({ address: e.target.value })}
          />
        </Field>
        <Field
          id={`${id}-responsable`}
          label="Responsable"
          size="lg"
          hint="Reçoit les alertes et les rappels d’inventaire de cet emplacement."
        >
          <ChoixMembre
            id={`${id}-responsable`}
            valeur={f.responsibleUserId}
            onChange={(v) => maj({ responsibleUserId: v })}
            membres={membres}
            vide="Aucun"
          />
        </Field>
      </FormGrid>
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <SubmitButton busy={envoi} busyLabel="Enregistrement…" className="self-start max-sm:w-full">
        {emplacement === null ? 'Créer l’emplacement' : 'Enregistrer'}
      </SubmitButton>
    </form>
  );
}

export function Emplacements(): React.ReactElement {
  const { actions, emplacements, membres, moi, rechargerEmplacements } = useAccesStocks();
  const gerer = peutGererStocks(actions);
  const [ouvert, setOuvert] = useState<StockLocationView | 'nouveau' | null>(null);
  const [sale, setSale] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function archiver(l: StockLocationView): Promise<void> {
    setErreur(null);
    try {
      await stockApi.archiveLocation(l.id, l.revision);
      setOuvert(null);
      rechargerEmplacements();
    } catch (err) {
      setErreur(messageStocks(err, 'Archivage impossible.'));
    }
  }

  const ouvrir = (v: StockLocationView | 'nouveau' | null): void => {
    setSale(false);
    setErreur(null);
    setOuvert(v);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Warehouse}
        titre="Emplacements"
        sousTitre="Où se trouve le stock : entrepôt, magasin, véhicule, chantier."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrir('nouveau')}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouvel emplacement
            </button>
          ) : null
        }
      />

      <Modal
        open={ouvert !== null}
        onClose={() => ouvrir(null)}
        dirty={sale}
        title={ouvert === 'nouveau' ? 'Nouvel emplacement' : 'Modifier l’emplacement'}
        size="md"
      >
        {ouvert !== null ? (
          <div className="flex flex-col gap-4">
            <FormulaireEmplacementVue
              emplacement={ouvert === 'nouveau' ? null : ouvert}
              onSale={setSale}
              onFait={() => {
                ouvrir(null);
                rechargerEmplacements();
              }}
            />
            {ouvert !== 'nouveau'
              ? gestesEmplacement(ouvert, actions)
                  .filter((g) => g.id === 'archiver')
                  .map((g) => (
                    <div
                      key={g.id}
                      className="flex flex-col gap-1 border-t border-[var(--border)] pt-3"
                    >
                      <button
                        type="button"
                        className={`${BOUTON_PETIT} self-start`}
                        disabled={!g.actif}
                        onClick={() => void archiver(ouvert)}
                      >
                        Archiver l’emplacement
                      </button>
                      {g.raison ? (
                        <p className="text-xs text-[var(--foreground-muted)]">{g.raison}</p>
                      ) : null}
                    </div>
                  ))
              : null}
            {erreur ? (
              <Alerte>
                <p>{erreur}</p>
              </Alerte>
            ) : null}
          </div>
        ) : null}
      </Modal>

      {emplacements === null ? (
        <Chargement texte="Chargement des emplacements…" />
      ) : !emplacements.ok ? (
        <EchecLecture
          erreur={emplacements.erreur}
          repli="Impossible de charger les emplacements."
          onReessayer={rechargerEmplacements}
        />
      ) : emplacements.valeur.length === 0 ? (
        <CarteVide>
          Aucun emplacement : le « Magasin principal » est créé à l’activation des stocks.
        </CarteVide>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {emplacements.valeur.map((l) => {
            const contenu = (
              <>
                <span className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold break-words">
                    <MapPin
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 text-[var(--module-run)]"
                    />
                    {l.name}
                  </span>
                  {l.isDefault ? <Badge tone="info">Par défaut</Badge> : null}
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {LIBELLES_TYPE_EMPLACEMENT[l.kind]}
                  {l.address ? ` · ${l.address}` : ''}
                </span>
                {l.responsibleUserId ? (
                  <span className="text-xs">
                    Responsable : {nomPersonne(membres, l.responsibleUserId, moi)}
                  </span>
                ) : null}
                <Link
                  href={`${STOCKS_BASE}/niveaux?emplacement=${encodeURIComponent(l.id)}`}
                  className="relative z-10 self-start text-xs underline underline-offset-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  Voir le stock de cet emplacement
                </Link>
              </>
            );
            const classe =
              'relative flex h-full w-full min-w-0 flex-col gap-2 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 text-left';
            return (
              <li key={l.id}>
                {gerer ? (
                  <div
                    className={`${classe} transition hover:-translate-y-0.5 hover:border-[var(--module-run)] hover:shadow-[var(--shadow-pop)]`}
                  >
                    <button
                      type="button"
                      className="absolute inset-0 rounded-[var(--radius-lg)]"
                      aria-label={`Modifier ${l.name}`}
                      onClick={() => ouvrir(l)}
                    />
                    {contenu}
                  </div>
                ) : (
                  <div className={classe}>{contenu}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
