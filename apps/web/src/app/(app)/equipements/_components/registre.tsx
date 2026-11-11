'use client';

// Registre des équipements — ADR-0046 § 3.1 et § 5.2 : liste filtrable (statut,
// catégorie, recherche sur la page reçue), cartes entièrement cliquables, création
// en fenêtre modale (`assets.manage`, `?nouveau=1`), export du registre si
// `report.export`. Les coûts n'apparaissent qu'aux rôles qui les voient.

import { Badge, Modal, Select, TextInput, buttonClasses } from '@lalanda/ui';
import { Download, Laptop, Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { assetsApi, type AssetView } from '@/lib/api-assets';

import { useShell } from '../../_components/shell-context';
import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';

import { EquipementFormulaire } from './equipement-formulaire';
import {
  LIBELLES_CONSTAT,
  LIBELLES_STATUT,
  formatJour,
  formatMontant,
  libelleBeneficiaire,
  lienEquipement,
  messageEquipements,
  peutExporterRegistre,
  peutGererEquipements,
  tonStatut,
  valeursAffichees,
} from './equipements-model';
import {
  Bandeau,
  CARTE,
  CarteVide,
  Chargement,
  EchecLecture,
  enregistrerFichier,
  useCategories,
} from './equipements-ui';
import {
  FILTRES_STATUT,
  correspond,
  requeteRegistre,
  type FiltresRegistre,
} from './registre-model';

export function Registre(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions } = useShell();
  const gerer = peutGererEquipements(actions);
  const exporter = peutExporterRegistre(actions);
  const creation = params.get('nouveau') === '1';
  const categories = useCategories();
  const [filtres, setFiltres] = useState<FiltresRegistre>({ statut: 'active', categoryId: '' });
  const [texte, setTexte] = useState('');
  const [items, setItems] = useState<AssetView[] | null>(null);
  const [masquees, setMasquees] = useState(true);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [sale, setSale] = useState(false);
  const [export_, setExport] = useState<'repos' | 'encours'>('repos');
  const [erreurExport, setErreurExport] = useState<string | null>(null);

  const charger = useCallback((f: FiltresRegistre, cursor: string | null) => {
    assetsApi
      .list(requeteRegistre(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setMasquees(p.valuesHidden);
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(err);
      });
  }, []);

  useEffect(() => charger(filtres, null), [filtres, charger]);

  const ouvrir = (oui: boolean): void => {
    setSale(false);
    router.replace(oui ? `${pathname}?nouveau=1` : pathname);
  };

  async function exporterRegistre(): Promise<void> {
    setErreurExport(null);
    setExport('encours');
    try {
      const f = await assetsApi.exportCsv();
      enregistrerFichier(f.blob, f.nom);
    } catch (err) {
      setErreurExport(messageEquipements(err, 'L’export n’a pas pu être produit.'));
    } finally {
      setExport('repos');
    }
  }

  const valeurs = valeursAffichees(actions, masquees);
  const visibles = (items ?? []).filter((a) => correspond(a, texte));

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={Laptop}
        titre="Registre"
        sousTitre="Tout le matériel de l’organisation : qui l’a, dans quel état, depuis quand."
        actions={
          <>
            {exporter ? (
              <button
                type="button"
                className={buttonClasses('secondary', 'sm')}
                disabled={export_ === 'encours'}
                onClick={() => void exporterRegistre()}
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                {export_ === 'encours' ? 'Export…' : 'Exporter (CSV)'}
              </button>
            ) : null}
            {gerer ? (
              <button
                type="button"
                className={buttonClasses('primary', 'sm')}
                aria-haspopup="dialog"
                onClick={() => ouvrir(true)}
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Nouvel équipement
              </button>
            ) : null}
          </>
        }
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <TextInput
            type="search"
            aria-label="Rechercher un équipement"
            placeholder="Nom, numéro, marque, série…"
            className="lg:max-w-xs"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            leading={<Search aria-hidden="true" className="h-4 w-4" />}
          />
          <Select
            aria-label="Catégorie"
            className="lg:max-w-[14rem]"
            value={filtres.categoryId}
            onChange={(v) => setFiltres({ ...filtres, categoryId: v })}
            loading={categories === null}
            options={[
              { value: '', label: 'Toutes les catégories' },
              ...(categories?.ok ? categories.valeur : []).map((c) => ({
                value: c.id,
                label: c.name,
              })),
            ]}
          />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
            {FILTRES_STATUT.map((f) => (
              <button
                key={f.valeur}
                type="button"
                className={BOUTON_PETIT}
                aria-pressed={filtres.statut === f.valeur}
                onClick={() => setFiltres({ ...filtres, statut: f.valeur })}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </Bandeau>

      {erreurExport ? (
        <Alerte>
          <p>{erreurExport}</p>
        </Alerte>
      ) : null}

      <Modal
        open={gerer && creation}
        onClose={() => ouvrir(false)}
        dirty={sale}
        title="Nouvel équipement"
        description="Le numéro EQ-… est attribué par Lalanda à l’enregistrement."
        size="lg"
      >
        <EquipementFormulaire
          equipement={null}
          onSale={setSale}
          onEnregistre={(a) => router.push(lienEquipement(a.id))}
        />
      </Modal>

      {erreur ? <EchecLecture erreur={erreur} repli="Impossible de charger le registre." /> : null}

      {items === null ? (
        <Chargement texte="Chargement du registre…" />
      ) : visibles.length === 0 ? (
        erreur ? null : (
          <CarteVide>
            {items.length === 0
              ? 'Aucun équipement ne correspond à ces filtres.'
              : 'Aucun équipement de cette page ne correspond à la recherche.'}
          </CarteVide>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibles.map((a) => (
            <li key={a.id}>
              <Link href={lienEquipement(a.id)} className={CARTE}>
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-semibold break-words">{a.name}</span>
                  <Badge tone={tonStatut(a.status)}>{LIBELLES_STATUT[a.status]}</Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {a.number}
                  {a.categoryName ? ` · ${a.categoryName}` : ''}
                  {a.brand ? ` · ${a.brand}` : ''}
                  {a.model ? ` ${a.model}` : ''}
                </span>
                <span className="text-sm break-words">
                  {a.status === 'disposed'
                    ? `Cédé le ${formatJour(a.disposal?.on ?? null)}`
                    : `Chez : ${libelleBeneficiaire(a.currentAssignment?.assignee)}`}
                </span>
                {a.findings.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {a.findings.map((c) => (
                      <Badge key={c} tone="warning">
                        {LIBELLES_CONSTAT[c] ?? c}
                      </Badge>
                    ))}
                  </span>
                ) : null}
                {valeurs ? (
                  <span className="mt-auto text-xs tabular-nums text-[var(--foreground-muted)]">
                    {a.acquisition.cost === null
                      ? 'Coût inconnu, acquis le '
                      : `Acquis ${formatMontant(a.acquisition.cost, a.acquisition.currency)} le `}
                    {formatJour(a.acquisition.on)}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtres, suivante)}
        >
          Afficher plus d’équipements
        </button>
      ) : null}
    </section>
  );
}
