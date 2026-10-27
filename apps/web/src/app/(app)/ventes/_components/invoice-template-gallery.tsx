'use client';

// Ventes › Modèle de facture (ADR-0028 § 8).
//
// Galerie des six modèles, chacun montré par un APERÇU RÉEL rendu par l'API
// (vignette PNG de la première page d'une facture fictive marquée EXEMPLE, aux
// couleurs de l'organisation). Choix des options, aperçu agrandi, PDF complet,
// enregistrement. Consultation : `sales.read` ; enregistrement :
// `organization.manage` — l'API refuse de toute façon, l'écran l'annonce.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  type InvoiceTemplateCatalogEntry,
  type InvoiceTemplateId,
  type InvoiceTemplateOptions,
  type InvoiceTemplatesView,
} from '@/lib/api';

import { CustomTemplatePackages } from './custom-template-packages';
import {
  PALETTE_LABELS,
  choisirModele,
  cleApercu,
  estModifiee,
  optionsAffichees,
  selectionInitiale,
  versEnvoi,
  type SelectionModele,
} from './template-model';

const BOUTON =
  'rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--accent)] disabled:opacity-50';

function messageDe(err: unknown, repli: string): string {
  const d = (err as { detail?: unknown } | null)?.detail;
  if (typeof d === 'object' && d !== null && 'message' in d) {
    return String((d as { message: unknown }).message);
  }
  return repli;
}

/** Cache d'images d'aperçu (URL `blob:`), libérées au démontage. */
function useApercus() {
  const cache = useRef(new Map<string, string>());
  const [, rafraichir] = useState(0);
  useEffect(() => {
    const c = cache.current;
    return () => {
      for (const url of c.values()) URL.revokeObjectURL(url);
      c.clear();
    };
  }, []);
  const obtenir = useCallback(
    async (id: InvoiceTemplateId, o: Partial<InvoiceTemplateOptions>): Promise<string> => {
      const cle = cleApercu(id, o);
      const hit = cache.current.get(cle);
      if (hit) return hit;
      const blob = await api.getInvoiceTemplatePreview(id, o, 'png');
      const url = URL.createObjectURL(blob);
      cache.current.set(cle, url);
      rafraichir((n) => n + 1);
      return url;
    },
    [],
  );
  return obtenir;
}

export function InvoiceTemplateGallery(): React.ReactElement {
  const [vue, setVue] = useState<InvoiceTemplatesView | null>(null);
  const [gerer, setGerer] = useState(false);
  const [sel, setSel] = useState<SelectionModele | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const obtenir = useApercus();

  const charger = useCallback(async (): Promise<void> => {
    try {
      const [v, p] = await Promise.all([
        api.getInvoiceTemplates(),
        api.getMyPermissions().catch(() => ({ actions: [] as string[] })),
      ]);
      setVue(v);
      setSel(selectionInitiale(v));
      setGerer((p.actions as string[]).includes('organization.manage'));
    } catch (err) {
      setErreur(messageDe(err, 'Impossible de charger les modèles de facture.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function enregistrer(): Promise<void> {
    if (!vue || !sel) return;
    setOccupe(true);
    setErreur(null);
    setNotice(null);
    try {
      const v = await api.putInvoiceTemplate(versEnvoi(sel, vue.revision));
      setVue(v);
      setSel(selectionInitiale(v));
      setNotice(
        v.current
          ? `Modèle « ${v.templates.find((t) => t.id === v.current?.templateId)?.label ?? ''} » enregistré : il s’appliquera aux prochaines factures émises.`
          : 'Présentation d’origine rétablie pour les prochaines factures.',
      );
    } catch (err) {
      setErreur(messageDe(err, 'Enregistrement impossible.'));
      if ((err as { status?: number }).status === 409) await charger();
    } finally {
      setOccupe(false);
    }
  }

  if (!vue || !sel) {
    return erreur ? (
      <p role="alert" className="text-sm text-[var(--danger)]">
        {erreur}
      </p>
    ) : (
      <p className="text-sm text-[var(--foreground-muted)]">Chargement…</p>
    );
  }

  const entree = vue.templates.find((t) => t.id === sel.templateId) ?? null;
  const modifiee = estModifiee(sel, vue);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex max-w-3xl flex-col gap-1">
        <p className="text-sm text-[var(--foreground-muted)]">
          Choisissez la présentation de vos factures. Le contenu exigé par la DGI (intitulé, numéro,
          vendeur, client, lignes, ventilation, totaux, montant en lettres, éléments de sécurité et
          QR code, mention de test) est imposé et identique dans chaque modèle. Une facture déjà
          émise se réimprime toujours avec la présentation de son émission.
        </p>
        <p className="text-sm text-[var(--foreground-muted)]">
          Logos, couleurs et police viennent de{' '}
          <Link href="/organisation/identite" className="underline underline-offset-2">
            Organisation › Identité visuelle
          </Link>
          .
        </p>
      </div>

      {erreur ? (
        <div
          role="alert"
          className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]"
        >
          {erreur}
        </div>
      ) : null}
      <span aria-live="polite" className="text-xs text-[var(--foreground-muted)]">
        {notice ?? ''}
      </span>
      {vue.current?.templateId === 'sur-mesure' && vue.current.package ? (
        <p className="text-sm">
          Modèle personnalisé en vigueur : <strong>{vue.current.package.name}</strong> version{' '}
          {vue.current.package.version} (voir « Modèles personnalisés » plus bas). Choisir un modèle
          ci-dessous le remplacera pour les prochaines factures.
        </p>
      ) : null}

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Modèles de facture">
        {vue.templates.map((t) => (
          <li key={t.id}>
            <CarteModele
              entree={t}
              actif={sel.templateId === t.id}
              enVigueur={vue.current?.templateId === t.id}
              obtenir={obtenir}
              onChoisir={() => setSel(choisirModele(vue, t.id))}
            />
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={BOUTON}
          aria-pressed={sel.templateId === null}
          onClick={() => setSel(choisirModele(vue, null))}
        >
          Présentation d’origine{vue.current === null ? ' (en vigueur)' : ''}
        </button>
        <span className="text-xs text-[var(--foreground-muted)]">
          La mise en page historique de Lalanda, sans logo ni couleur.
        </span>
      </div>

      {entree ? (
        <OptionsEtApercu
          entree={entree}
          vue={vue}
          sel={sel}
          onChange={setSel}
          obtenir={obtenir}
          desactive={!gerer}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
        {gerer ? (
          <button
            type="button"
            className={BOUTON}
            disabled={occupe || !modifiee}
            onClick={() => void enregistrer()}
          >
            {occupe ? 'Enregistrement…' : 'Enregistrer ce choix'}
          </button>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            Le modèle de facture se choisit par un Propriétaire ou un Administrateur de
            l’organisation. Vous pouvez parcourir les aperçus.
          </p>
        )}
      </div>

      <CustomTemplatePackages onChange={() => void charger()} />
    </div>
  );
}

function CarteModele({
  entree,
  actif,
  enVigueur,
  obtenir,
  onChoisir,
}: {
  entree: InvoiceTemplateCatalogEntry;
  actif: boolean;
  enVigueur: boolean;
  obtenir: (id: InvoiceTemplateId, o: Partial<InvoiceTemplateOptions>) => Promise<string>;
  onChoisir: () => void;
}): React.ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  useEffect(() => {
    let annule = false;
    obtenir(entree.id, {})
      .then((u) => {
        if (!annule) setSrc(u);
      })
      .catch(() => {
        if (!annule) setEchec(true);
      });
    return () => {
      annule = true;
    };
  }, [entree.id, obtenir]);
  return (
    <button
      type="button"
      onClick={onChoisir}
      aria-pressed={actif}
      className={`flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition ${
        actif
          ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30'
          : 'border-[var(--border)] hover:border-[var(--border-strong)]'
      }`}
    >
      <div className="aspect-[794/1123] w-full overflow-hidden rounded-md border border-[var(--border)] bg-white">
        {src ? (
          // Image rendue par l'API (blob:) ; aucune optimisation `next/image` utile.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={`Aperçu du modèle ${entree.label} (facture fictive)`}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-gray-500">
            {echec ? 'Aperçu indisponible' : 'Rendu de l’aperçu…'}
          </div>
        )}
      </div>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold">{entree.label}</span>
        {enVigueur ? (
          <span className="rounded-full border border-[var(--accent)] px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-[var(--accent)]">
            En vigueur
          </span>
        ) : null}
      </span>
      <span className="text-xs text-[var(--foreground-muted)]">{entree.description}</span>
    </button>
  );
}

function OptionsEtApercu({
  entree,
  vue,
  sel,
  onChange,
  obtenir,
  desactive,
}: {
  entree: InvoiceTemplateCatalogEntry;
  vue: InvoiceTemplatesView;
  sel: SelectionModele;
  onChange: (s: SelectionModele) => void;
  obtenir: (id: InvoiceTemplateId, o: Partial<InvoiceTemplateOptions>) => Promise<string>;
  desactive: boolean;
}): React.ReactElement {
  const affichees = optionsAffichees(sel, entree, vue.identity);
  const [src, setSrc] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pdf, setPdf] = useState(false);

  // Aperçu agrandi, demandé après une courte pause (le nuancier émet en continu).
  useEffect(() => {
    let annule = false;
    setErreur(null);
    const t = setTimeout(() => {
      obtenir(entree.id, affichees)
        .then((u) => {
          if (!annule) setSrc(u);
        })
        .catch((err: unknown) => {
          if (!annule) setErreur(messageDe(err, 'Aperçu indisponible.'));
        });
    }, 350);
    return () => {
      annule = true;
      clearTimeout(t);
    };
    // `affichees` est recalculé à chaque rendu : on dépend de ses valeurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entree.id, affichees.palette, affichees.accent, affichees.font, obtenir]);

  async function ouvrirPdf(): Promise<void> {
    setPdf(true);
    // Fenêtre ouverte DANS le geste de l'utilisateur (sinon bloquée comme
    // fenêtre surgissante), puis dirigée vers le PDF une fois rendu.
    const fenetre = window.open('', '_blank');
    try {
      const blob = await api.getInvoiceTemplatePreview(entree.id, affichees, 'pdf');
      const url = URL.createObjectURL(blob);
      if (fenetre) fenetre.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      fenetre?.close();
      setErreur(messageDe(err, 'PDF indisponible.'));
    } finally {
      setPdf(false);
    }
  }

  const accents = [
    ...(vue.identity.primaryColor ? [vue.identity.primaryColor] : []),
    ...entree.accentSuggestions,
  ].filter((c, i, a) => a.indexOf(c) === i);

  return (
    <section
      aria-labelledby="options-titre"
      className="grid gap-6 rounded-xl border border-[var(--border)] p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
    >
      <div className="flex flex-col gap-5">
        <h2 id="options-titre" className="font-display text-lg font-semibold">
          Options — {entree.label}
        </h2>

        <fieldset className="flex flex-col gap-2" disabled={desactive}>
          <legend className="text-sm font-medium">Palette</legend>
          {entree.palettes.map((p) => (
            <label key={p} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="palette"
                checked={affichees.palette === p}
                onChange={() => onChange({ ...sel, palette: p })}
              />
              {PALETTE_LABELS[p]}
            </label>
          ))}
        </fieldset>

        <fieldset
          className="flex flex-col gap-2"
          disabled={desactive || affichees.palette === 'mono'}
        >
          <legend className="text-sm font-medium">Couleur d’accent</legend>
          <div className="flex flex-wrap items-center gap-2">
            {accents.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ ...sel, accent: c })}
                aria-pressed={affichees.accent === c}
                aria-label={`${c}${c === vue.identity.primaryColor ? ' (couleur de la marque)' : ''}`}
                title={c === vue.identity.primaryColor ? 'Couleur de la marque' : c}
                className={`h-8 w-8 rounded-full border-2 ${
                  affichees.accent === c ? 'border-[var(--foreground)]' : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
            <input
              type="color"
              aria-label="Autre couleur d’accent"
              value={affichees.accent}
              onChange={(e) => onChange({ ...sel, accent: e.target.value.toLowerCase() })}
              className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
            />
            {sel.accent !== null ? (
              <button
                type="button"
                className="text-xs underline underline-offset-2"
                onClick={() => onChange({ ...sel, accent: null })}
              >
                Suivre la couleur de la marque
              </button>
            ) : null}
          </div>
          {affichees.palette === 'mono' ? (
            <p className="text-xs text-[var(--foreground-muted)]">
              Noir et blanc : aucune couleur, logos en niveaux de gris.
            </p>
          ) : null}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="modele-police" className="text-sm font-medium">
            {entree.id === 'editoriale' ? 'Paire de polices (titres + texte)' : 'Police'}
          </label>
          <select
            id="modele-police"
            disabled={desactive}
            value={affichees.font}
            onChange={(e) => onChange({ ...sel, font: e.target.value })}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-50"
          >
            {entree.fonts.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={`${BOUTON} self-start`}
          disabled={pdf}
          onClick={() => void ouvrirPdf()}
        >
          {pdf ? 'Rendu du PDF…' : 'Ouvrir l’aperçu PDF complet'}
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className="aspect-[794/1123] w-full overflow-hidden rounded-md border border-[var(--border)] bg-white">
          {src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={`Aperçu du modèle ${entree.label} avec les options choisies (facture fictive)`}
              className="h-full w-full object-contain"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-gray-500">
              Rendu de l’aperçu…
            </div>
          )}
        </div>
        {erreur ? (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {erreur}
          </p>
        ) : (
          <p className="text-xs text-[var(--foreground-muted)]">
            Aperçu réel rendu par Lalanda sur une facture fictive marquée EXEMPLE.
          </p>
        )}
      </div>
    </section>
  );
}
