'use client';

// Ventes › Modèle de facture › Modèles personnalisés (ADR-0029 § 8).
//
// Un modèle sur mesure est un paquet (.zip) écrit par un développeur ou un
// agent IA d'après docs/modeles-facture/. Ici : téléverser (l'API valide tout
// et rend un rapport lisible), voir l'aperçu RÉEL sur la facture fictive
// EXEMPLE, activer une version. L'aperçu est obligatoire avant l'activation :
// le moteur garantit la zone DGI, pas la lisibilité du reste.
// Consultation : `sales.read` ; téléversement et activation : `organization.manage`.

import { buttonClasses } from '@lalanda/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  api,
  type TemplatePackageReport,
  type TemplatePackagesView,
  type TemplatePackageView,
} from '@/lib/api';

import {
  SELECTION_VIDE,
  empreinteCourte,
  ligneProbleme,
  optionsPaquet,
  rapportDeRefus,
  regrouperParModele,
  taille,
  type SelectionPaquet,
} from './custom-package-model';
import { PALETTE_LABELS } from './template-model';

/** Boutons du design system (ADR-0030). */
const BOUTON = buttonClasses('secondary', 'sm');
const BOUTON_PRINCIPAL = buttonClasses('primary', 'sm');

function messageDe(err: unknown, repli: string): string {
  const d = (err as { detail?: unknown } | null)?.detail;
  if (typeof d === 'object' && d !== null && 'message' in d) {
    return String((d as { message: unknown }).message);
  }
  return repli;
}

interface Identite {
  primaryColor: string | null;
  font: string | null;
}

export function CustomTemplatePackages({
  onChange,
}: {
  /** Appelé après une activation : la galerie des modèles intégrés se recharge. */
  onChange?: () => void;
}): React.ReactElement | null {
  const [vue, setVue] = useState<TemplatePackagesView | null>(null);
  const [identite, setIdentite] = useState<Identite>({ primaryColor: null, font: null });
  const [gerer, setGerer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rapport, setRapport] = useState<TemplatePackageReport | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const fichier = useRef<HTMLInputElement>(null);

  const charger = useCallback(async (): Promise<void> => {
    try {
      const [v, t, p] = await Promise.all([
        api.getInvoiceTemplatePackages(),
        api.getInvoiceTemplates(),
        api.getMyPermissions().catch(() => ({ actions: [] as string[] })),
      ]);
      setVue(v);
      setIdentite({ primaryColor: t.identity.primaryColor, font: t.identity.font });
      setGerer((p.actions as string[]).includes('organization.manage'));
    } catch (err) {
      setErreur(messageDe(err, 'Impossible de charger les modèles personnalisés.'));
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  async function televerser(file: File): Promise<void> {
    setEnvoi(true);
    setErreur(null);
    setNotice(null);
    setRapport(null);
    try {
      const r = await api.uploadInvoiceTemplatePackage(file);
      setVue(r);
      setRapport(r.report);
      setOuvert(r.installed.packageId);
      setNotice(
        r.created
          ? `« ${r.installed.name} » ${r.installed.version} installé. Vérifiez l’aperçu, puis activez-le.`
          : `« ${r.installed.name} » ${r.installed.version} était déjà installé à l’identique.`,
      );
    } catch (err) {
      const refus = rapportDeRefus(err);
      if (refus) setRapport(refus);
      setErreur(messageDe(err, 'Téléversement impossible.'));
    } finally {
      setEnvoi(false);
      if (fichier.current) fichier.current.value = '';
    }
  }

  async function activer(p: TemplatePackageView, sel: SelectionPaquet): Promise<void> {
    if (!vue) return;
    setErreur(null);
    setNotice(null);
    try {
      const v = await api.activateInvoiceTemplatePackage({
        packageId: p.packageId,
        options: sel,
        expectedRevision: vue.revision,
      });
      setVue(v);
      setNotice(
        `Modèle « ${p.name} » ${p.version} activé : il s’appliquera aux prochaines factures émises.`,
      );
      onChange?.();
    } catch (err) {
      setErreur(messageDe(err, 'Activation impossible.'));
      if ((err as { status?: number }).status === 409) await charger();
    }
  }

  if (!vue) {
    return erreur ? (
      <p role="alert" className="text-sm text-[var(--danger)]">
        {erreur}
      </p>
    ) : null;
  }

  const groupes = regrouperParModele(vue.packages);

  return (
    <section
      aria-labelledby="sur-mesure-titre"
      className="flex flex-col gap-4 border-t border-[var(--border)] pt-6"
    >
      <div className="flex max-w-3xl flex-col gap-1">
        <h2 id="sur-mesure-titre" className="font-display text-lg font-semibold">
          Modèles personnalisés
        </h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Un modèle à votre charte, écrit par un développeur ou un assistant IA d’après le guide des
          créateurs de modèles Lalanda, puis téléversé ici en archive .zip. Lalanda vérifie tout le
          paquet avant de l’installer et pose lui-même la zone DGI (bandeau de test, DUPLICATA,
          éléments de sécurité et QR code) : un modèle ne peut ni la retirer ni la masquer. Une
          version installée ne change plus ; une facture émise garde la sienne.
        </p>
      </div>

      {gerer ? (
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${BOUTON} cursor-pointer`}>
            {envoi ? 'Vérification du modèle…' : 'Téléverser un modèle (.zip)'}
            <input
              ref={fichier}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              disabled={envoi || !vue.limits.storageAvailable}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void televerser(f);
              }}
            />
          </label>
          <span className="text-xs text-[var(--foreground-muted)]">
            {vue.limits.storageAvailable
              ? `Archive de ${taille(vue.limits.maxArchiveBytes)} au plus.`
              : 'Stockage des fichiers indisponible : téléversement impossible pour le moment.'}
          </span>
        </div>
      ) : (
        <p className="text-sm text-[var(--foreground-muted)]">
          Les modèles personnalisés s’installent et s’activent par un Propriétaire ou un
          Administrateur de l’organisation. Vous pouvez parcourir les aperçus.
        </p>
      )}

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

      {rapport ? <RapportValidation rapport={rapport} onFermer={() => setRapport(null)} /> : null}

      {groupes.length === 0 ? (
        <p className="text-sm text-[var(--foreground-muted)]">
          Aucun modèle personnalisé installé.
        </p>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Modèles personnalisés installés">
          {groupes.map((g) => (
            <li key={g.templateId} className="rounded-xl border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold">{g.name}</span>
                <span className="font-mono text-xs text-[var(--foreground-muted)]">
                  {g.templateId}
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-2" aria-label={`Versions de ${g.name}`}>
                {g.versions.map((p) => (
                  <li key={p.packageId}>
                    <VersionPaquet
                      p={p}
                      ouvert={ouvert === p.packageId}
                      onOuvrir={() => setOuvert(ouvert === p.packageId ? null : p.packageId)}
                      identite={identite}
                      selectionEnregistree={
                        vue.current?.packageId === p.packageId
                          ? {
                              palette: vue.current.options.palette,
                              accent: vue.current.options.accent,
                              font: vue.current.options.font,
                            }
                          : SELECTION_VIDE
                      }
                      gerer={gerer}
                      onActiver={(sel) => activer(p, sel)}
                    />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RapportValidation({
  rapport,
  onFermer,
}: {
  rapport: TemplatePackageReport;
  onFermer: () => void;
}): React.ReactElement {
  return (
    <div
      className={`flex flex-col gap-2 rounded-md border p-3 text-sm ${
        rapport.ok ? 'border-[var(--border)]' : 'border-[var(--danger)]/30 bg-[var(--danger-bg)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <strong>
          {rapport.ok
            ? 'Rapport de validation : modèle valide'
            : `Rapport de validation : ${rapport.errors.length} erreur(s) à corriger`}
        </strong>
        <button type="button" className="text-xs underline underline-offset-2" onClick={onFermer}>
          Fermer
        </button>
      </div>
      {rapport.manifest ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          {rapport.manifest.name} — {rapport.manifest.id}@{rapport.manifest.version}
          {rapport.digest ? ` — empreinte ${empreinteCourte(rapport.digest)}…` : ''}
        </p>
      ) : null}
      {rapport.cases.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-label="Documents vérifiés">
          {rapport.cases.map((c) => (
            <li key={c.name}>
              {c.ok ? '✓' : '✗'} {c.name}
            </li>
          ))}
        </ul>
      ) : null}
      {rapport.errors.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 font-mono text-xs text-[var(--danger)]">
          {rapport.errors.map((e, i) => (
            <li key={i}>{ligneProbleme(e)}</li>
          ))}
          {rapport.truncated ? <li>… (rapport tronqué)</li> : null}
        </ul>
      ) : null}
      {rapport.warnings.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 font-mono text-xs">
          {rapport.warnings.map((e, i) => (
            <li key={i}>Avertissement : {ligneProbleme(e)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function VersionPaquet({
  p,
  ouvert,
  onOuvrir,
  identite,
  selectionEnregistree,
  gerer,
  onActiver,
}: {
  p: TemplatePackageView;
  ouvert: boolean;
  onOuvrir: () => void;
  identite: Identite;
  selectionEnregistree: SelectionPaquet;
  gerer: boolean;
  onActiver: (sel: SelectionPaquet) => Promise<void>;
}): React.ReactElement {
  const [sel, setSel] = useState<SelectionPaquet>(selectionEnregistree);
  const [src, setSrc] = useState<string | null>(null);
  const [vu, setVu] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const affichees = optionsPaquet(p, sel, identite);

  // Aperçu PNG, demandé à l'ouverture puis après chaque changement d'options.
  useEffect(() => {
    if (!ouvert) return;
    let annule = false;
    let url: string | null = null;
    setErreur(null);
    setVu(false);
    const t = setTimeout(() => {
      api
        .getInvoiceTemplatePackagePreview(p.packageId, affichees, 'png')
        .then((blob) => {
          if (annule) return;
          url = URL.createObjectURL(blob);
          setSrc(url);
        })
        .catch((err: unknown) => {
          if (!annule) setErreur(messageDe(err, 'Aperçu indisponible.'));
        });
    }, 300);
    return () => {
      annule = true;
      clearTimeout(t);
      if (url) URL.revokeObjectURL(url);
    };
    // `affichees` est recalculé à chaque rendu : on dépend de ses valeurs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ouvert, p.packageId, affichees.palette, affichees.accent, affichees.font]);

  async function ouvrirPdf(): Promise<void> {
    const fenetre = window.open('', '_blank');
    try {
      const blob = await api.getInvoiceTemplatePackagePreview(p.packageId, affichees, 'pdf');
      const url = URL.createObjectURL(blob);
      if (fenetre) fenetre.location.href = url;
      else window.location.assign(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      fenetre?.close();
      setErreur(messageDe(err, 'PDF indisponible.'));
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[var(--border)] p-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Version {p.version}</span>
        {p.active ? (
          <span className="rounded-full border border-[var(--accent)] px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-[var(--accent)]">
            En vigueur
          </span>
        ) : null}
        <span className="text-xs text-[var(--foreground-muted)]">
          {p.author.name}
          {p.publisher ? ` · éditeur ${p.publisher.name}` : ''} · licence {p.license} ·{' '}
          {taille(p.byteSize)} · installé le {new Date(p.installedAt).toLocaleDateString('fr-FR')} ·
          empreinte{' '}
          <span className="font-mono" title={p.contentSha256}>
            {empreinteCourte(p.contentSha256)}
          </span>
        </span>
        <button
          type="button"
          className="ml-auto text-xs underline underline-offset-2"
          aria-expanded={ouvert}
          onClick={onOuvrir}
        >
          {ouvert ? 'Masquer l’aperçu' : 'Aperçu et activation'}
        </button>
      </div>
      <p className="text-xs text-[var(--foreground-muted)]">{p.description}</p>

      {ouvert ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">Palette</legend>
              {p.options.palettes.map((pal) => (
                <label key={pal} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`palette-${p.packageId}`}
                    checked={affichees.palette === pal}
                    onChange={() => setSel({ ...sel, palette: pal })}
                  />
                  {PALETTE_LABELS[pal]}
                </label>
              ))}
            </fieldset>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`accent-${p.packageId}`} className="text-sm font-medium">
                Couleur d’accent
              </label>
              <input
                id={`accent-${p.packageId}`}
                type="color"
                value={affichees.accent}
                disabled={affichees.palette === 'mono'}
                onChange={(e) => setSel({ ...sel, accent: e.target.value.toLowerCase() })}
                className="h-8 w-10 cursor-pointer rounded border border-[var(--border)] bg-transparent"
              />
              {sel.accent !== null ? (
                <button
                  type="button"
                  className="text-xs underline underline-offset-2"
                  onClick={() => setSel({ ...sel, accent: null })}
                >
                  Suivre la couleur de la marque
                </button>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`police-${p.packageId}`} className="text-sm font-medium">
                Police
              </label>
              <select
                id={`police-${p.packageId}`}
                value={affichees.font}
                onChange={(e) => setSel({ ...sel, font: e.target.value })}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm outline-none transition focus:border-[var(--accent)]"
              >
                {p.options.fonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={BOUTON} onClick={() => void ouvrirPdf()}>
                Ouvrir l’aperçu PDF complet
              </button>
              {gerer ? (
                <button
                  type="button"
                  className={BOUTON_PRINCIPAL}
                  disabled={!vu || occupe}
                  title={vu ? undefined : 'Attendez l’aperçu avant d’activer.'}
                  onClick={async () => {
                    setOccupe(true);
                    try {
                      await onActiver(sel);
                    } finally {
                      setOccupe(false);
                    }
                  }}
                >
                  {occupe
                    ? 'Activation…'
                    : p.active
                      ? 'Enregistrer ces options'
                      : `Activer la version ${p.version}`}
                </button>
              ) : null}
            </div>
            <p className="text-xs text-[var(--foreground-muted)]">
              Relisez l’aperçu avant d’activer : Lalanda garantit la zone DGI et la présence de
              chaque mention, pas la lisibilité des couleurs choisies par le modèle.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="aspect-[794/1123] w-full overflow-hidden rounded-md border border-[var(--border)] bg-white">
              {src ? (
                // Image rendue par l'API (blob:) ; aucune optimisation `next/image` utile.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Aperçu du modèle ${p.name} ${p.version} (facture fictive)`}
                  className="h-full w-full object-contain"
                  onLoad={() => setVu(true)}
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
        </div>
      ) : null}
    </div>
  );
}
