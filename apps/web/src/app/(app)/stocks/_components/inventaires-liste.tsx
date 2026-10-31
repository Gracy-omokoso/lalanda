'use client';

// Inventaires — ADR-0046 § 2.7 : liste filtrable ; création en fenêtre modale
// (`stock.manage`, `?nouveau=1`) : emplacement, tous les articles ou une
// sélection (inventaire tournant), comptage à l'aveugle, compteurs désignés.

import { Badge, Modal, buttonClasses } from '@lalanda/ui';
import { ClipboardCheck, Plus, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useState } from 'react';

import { stockApi, type StockCountView } from '@/lib/api-stock';

import { Alerte, BOUTON_PETIT, Champ, aria } from '../../ventes/_components/form-ui';

import {
  FILTRES_INVENTAIRES,
  formulaireInventaire,
  preparerInventaire,
  progression,
  requeteInventaires,
  type FiltreInventaires,
  type FormulaireInventaire,
} from './inventaires-model';
import { useAccesStocks } from './stocks-access';
import {
  LIBELLES_STATUT_INVENTAIRE,
  formatInstantJour,
  lienInventaire,
  messageStocks,
  peutGererStocks,
  tonStatutInventaire,
} from './stocks-model';
import {
  Bandeau,
  CARTE,
  CarteVide,
  Chargement,
  ChoixArticle,
  ChoixEmplacement,
  EchecLecture,
} from './stocks-ui';

function NouvelInventaire({
  onCree,
  onSale,
}: {
  onCree: (c: StockCountView) => void;
  onSale: (s: boolean) => void;
}): React.ReactElement {
  const id = useId();
  const { membres } = useAccesStocks();
  const [f, setF] = useState<FormulaireInventaire>(formulaireInventaire());
  const [noms, setNoms] = useState<Record<string, string>>({});
  const [choix, setChoix] = useState('');
  const [champs, setChamps] = useState<Record<string, string>>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const maj = (p: Partial<FormulaireInventaire>): void => {
    setF((x) => ({ ...x, ...p }));
    onSale(true);
  };

  async function creer(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setErreur(null);
    const p = preparerInventaire(f);
    setChamps(p.ok ? {} : p.champs);
    if (!p.ok) return;
    setEnvoi(true);
    try {
      onCree(await stockApi.createCount(p.corps));
    } catch (err) {
      setErreur(messageStocks(err, 'Création impossible.'));
    } finally {
      setEnvoi(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void creer(e)} className="flex flex-col gap-4">
      <Champ
        id={`${id}-emplacement`}
        label="Emplacement à compter"
        requis
        erreur={champs['location']}
      >
        <ChoixEmplacement
          id={`${id}-emplacement`}
          valeur={f.locationId}
          vide="Choisir"
          onChange={(v) => maj({ locationId: v })}
          aria={aria(`${id}-emplacement`, champs['location'])}
        />
      </Champ>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Articles comptés</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${id}-portee`}
            checked={f.scope === 'all'}
            onChange={() => maj({ scope: 'all' })}
          />
          Tous les articles suivis présents ou seuillés à cet emplacement
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`${id}-portee`}
            checked={f.scope === 'items'}
            onChange={() => maj({ scope: 'items' })}
          />
          Une sélection d’articles (inventaire tournant)
        </label>
      </fieldset>
      {f.scope === 'items' ? (
        <div className="flex flex-col gap-2">
          <Champ id={`${id}-article`} label="Ajouter un article" erreur={champs['items']}>
            <ChoixArticle
              id={`${id}-article`}
              valeur={choix}
              onChange={(a) => {
                setChoix('');
                if (a && !f.itemIds.includes(a.id)) {
                  setNoms((n) => ({ ...n, [a.id]: a.name }));
                  maj({ itemIds: [...f.itemIds, a.id] });
                }
              }}
            />
          </Champ>
          {f.itemIds.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {f.itemIds.map((i) => (
                <li key={i}>
                  <button
                    type="button"
                    className={`${BOUTON_PETIT} inline-flex items-center gap-1`}
                    aria-label={`Retirer ${noms[i] ?? 'l’article'}`}
                    onClick={() => maj({ itemIds: f.itemIds.filter((x) => x !== i) })}
                  >
                    {noms[i] ?? 'Article'}
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={f.blind}
          onChange={(e) => maj({ blind: e.target.checked })}
        />
        <span>
          Comptage à l’aveugle
          <span className="block text-xs text-[var(--foreground-muted)]">
            Le compteur ne voit pas la quantité attendue : il compte ce qu’il voit.
          </span>
        </span>
      </label>
      {membres.length > 0 ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-medium">Compteurs</legend>
          <p className="text-xs text-[var(--foreground-muted)]">
            L’inventaire apparaît dans leurs tâches. Seuls les rôles qui comptent pourront saisir.
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {membres.map((m) => (
              <label key={m.userId} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.assignees.includes(m.userId)}
                  onChange={(e) =>
                    maj({
                      assignees: e.target.checked
                        ? [...f.assignees, m.userId]
                        : f.assignees.filter((x) => x !== m.userId),
                    })
                  }
                />
                {m.name}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {erreur ? (
        <Alerte>
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      <button
        type="submit"
        disabled={envoi}
        className={buttonClasses('primary', 'md', 'self-start')}
      >
        {envoi ? 'Création…' : 'Créer l’inventaire'}
      </button>
    </form>
  );
}

export function InventairesListe(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { actions, emplacements } = useAccesStocks();
  const gerer = peutGererStocks(actions);
  const creation = params.get('nouveau') === '1';
  const [filtre, setFiltre] = useState<FiltreInventaires>('counting');
  const [items, setItems] = useState<StockCountView[] | null>(null);
  const [suivante, setSuivante] = useState<string | null>(null);
  const [erreur, setErreur] = useState<unknown>(null);
  const [sale, setSale] = useState(false);

  const nom = (id: string): string =>
    (emplacements?.ok ? emplacements.valeur.find((l) => l.id === id)?.name : null) ?? 'Emplacement';

  const charger = useCallback((f: FiltreInventaires, cursor: string | null) => {
    stockApi
      .listCounts(requeteInventaires(f, cursor))
      .then((p) => {
        setItems((avant) => (cursor && avant ? [...avant, ...p.items] : p.items));
        setSuivante(p.nextCursor);
        setErreur(null);
      })
      .catch((err: unknown) => {
        setItems([]);
        setErreur(err);
      });
  }, []);

  useEffect(() => charger(filtre, null), [filtre, charger]);

  const ouvrir = (oui: boolean): void => {
    setSale(false);
    router.replace(oui ? `${pathname}?nouveau=1` : pathname);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <Bandeau
        icone={ClipboardCheck}
        titre="Inventaires"
        sousTitre="Compter ce qui est réellement là, voir les écarts, puis les valider."
        actions={
          gerer ? (
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              onClick={() => ouvrir(true)}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              Nouvel inventaire
            </button>
          ) : null
        }
      >
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer les inventaires">
          {FILTRES_INVENTAIRES.map((f) => (
            <button
              key={f.valeur}
              type="button"
              className={BOUTON_PETIT}
              aria-pressed={filtre === f.valeur}
              onClick={() => setFiltre(f.valeur)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </Bandeau>

      <Modal
        open={gerer && creation}
        onClose={() => ouvrir(false)}
        dirty={sale}
        title="Nouvel inventaire"
        description="Le premier inventaire d’un emplacement sert aussi à saisir le stock initial."
        size="md"
      >
        <NouvelInventaire onSale={setSale} onCree={(c) => router.push(lienInventaire(c.id))} />
      </Modal>

      {erreur ? (
        <EchecLecture erreur={erreur} repli="Impossible de charger les inventaires." />
      ) : null}

      {items === null ? (
        <Chargement texte="Chargement des inventaires…" />
      ) : items.length === 0 ? (
        erreur ? null : (
          <CarteVide>Aucun inventaire ne correspond.</CarteVide>
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((c) => (
            <li key={c.id}>
              <Link href={lienInventaire(c.id)} className={CARTE}>
                <span className="flex items-start justify-between gap-2">
                  <span className="font-semibold break-words">
                    {c.locationName ?? nom(c.locationId)}
                  </span>
                  <Badge tone={tonStatutInventaire(c.status)}>
                    {LIBELLES_STATUT_INVENTAIRE[c.status]}
                  </Badge>
                </span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {c.number ?? 'Sans numéro'} · {formatInstantJour(c.createdAt)}
                  {c.blind ? ' · à l’aveugle' : ''}
                </span>
                <span className="text-sm">{progression(c).phrase}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {suivante ? (
        <button
          type="button"
          className={`${BOUTON_PETIT} self-center`}
          onClick={() => charger(filtre, suivante)}
        >
          Afficher plus d’inventaires
        </button>
      ) : null}
    </section>
  );
}
