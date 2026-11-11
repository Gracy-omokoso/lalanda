'use client';

// `/rh/cartes` — cartes de service et de visite (ADR-0069).
//
// Trois blocs : (1) modèles par défaut de chaque type, choisis sur aperçu (données
// FICTIVES, bandeau « EXEMPLE »), variante de couleur et coordonnées imprimées ;
// (2) génération par lot (sélection de collaborateurs → PDF, planche A4 ou ZIP de
// PNG 300 dpi) ; (3) modèles sur mesure (paquet code ou gabarit graphiste) et
// guides téléchargeables. Lecture `hr.read`, écriture `hr.manage`.
//
// ADR-0074 : variante et format en `Select`, coordonnées en `Field` sur la
// grille sémantique, options d'impression en interrupteurs, sélection du lot
// en cases stylées. Mêmes champs envoyés.

import { Checkbox, Field, FormGrid, Select, Switch, TextInput, buttonClasses } from '@lalanda/ui';
import { Download, FileArchive, IdCard, Upload } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

import { hrApi, type HrEmployeeListItem } from '@/lib/api-hr';
import {
  hrCardsApi,
  type CardBatchFormat,
  type CardKind,
  type CardSettingsView,
  type CardTemplateSummary,
  type CardVariant,
} from '@/lib/api-hr-cards';

import { Alerte, BOUTON_PETIT } from '../../ventes/_components/form-ui';
import {
  LIBELLE_ORIENTATION,
  LIBELLE_TYPE,
  LIBELLE_VARIANTE,
  basculerSelection,
  messageExport,
  modelesDe,
} from './cartes-model';
import { useAccesRh } from './rh-access';
import { lire, messageRh, nomAffiche, peutGererRh, type Lecture } from './rh-model';
import { Chargement, EchecLecture, enregistrerFichier } from './rh-ui';

const SECTION =
  'flex flex-col gap-4 rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5';

/** Vignette d'aperçu, chargée à la demande (PNG 300 dpi d'exemple). */
function Vignette({
  modele,
  variante,
  choisi,
  onChoisir,
  version,
}: {
  modele: CardTemplateSummary;
  variante: CardVariant;
  choisi: boolean;
  onChoisir: (() => void) | null;
  version: number;
}): React.ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  const [echec, setEchec] = useState(false);
  useEffect(() => {
    let u: string | null = null;
    let annule = false;
    setUrl(null);
    setEchec(false);
    void hrCardsApi
      .preview(modele.id, { format: 'png', face: 'recto', variant: variante })
      .then((f) => {
        if (annule) return;
        u = URL.createObjectURL(f.blob);
        setUrl(u);
      })
      .catch(() => setEchec(true));
    return () => {
      annule = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [modele.id, variante, version]);
  const vertical = modele.orientation === 'vertical';
  return (
    <figure
      className={`flex flex-col gap-2 rounded-[var(--radius-md)] border p-2 ${
        choisi ? 'border-[var(--accent)] ring-2 ring-[var(--accent)]/30' : 'border-[var(--border)]'
      }`}
    >
      <div
        className={`flex items-center justify-center overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-muted)] ${
          vertical ? 'aspect-[54/86] w-2/3 self-center' : 'aspect-[86/54] w-full'
        }`}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- lien local éphémère
          <img
            src={url}
            alt={`Aperçu du modèle ${modele.name}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="text-xs text-[var(--foreground-muted)]">
            {echec ? 'Aperçu indisponible' : 'Aperçu…'}
          </span>
        )}
      </div>
      <figcaption className="flex flex-col gap-1 text-xs">
        <span className="font-medium">
          {modele.name}{' '}
          <span className="text-[var(--foreground-muted)]">
            · {LIBELLE_ORIENTATION[modele.orientation]}
          </span>
        </span>
        <span className="text-[var(--foreground-muted)]">{modele.description}</span>
        {onChoisir ? (
          <button type="button" className={BOUTON_PETIT} onClick={onChoisir} aria-pressed={choisi}>
            {choisi ? 'Modèle par défaut' : 'Choisir ce modèle'}
          </button>
        ) : null}
      </figcaption>
    </figure>
  );
}

export function CartesRh(): React.ReactElement {
  const { actions } = useAccesRh();
  const gerer = peutGererRh(actions);
  const id = useId();
  const [lecture, setLecture] = useState<Lecture<CardSettingsView> | null>(null);
  const [version, setVersion] = useState(0);
  const [brouillon, setBrouillon] = useState<CardSettingsView | null>(null);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [type, setType] = useState<CardKind>('badge');

  useEffect(() => {
    let annule = false;
    void lire(hrCardsApi.settings()).then((l) => {
      if (annule) return;
      setLecture(l);
      if (l.ok) setBrouillon(l.valeur);
    });
    return () => {
      annule = true;
    };
  }, [version]);

  const enregistrer = useCallback(async (b: CardSettingsView) => {
    setAlerte(null);
    setInfo(null);
    setOccupe(true);
    try {
      const s = await hrCardsApi.putSettings({
        expectedRevision: b.revision,
        badge: { templateId: b.badge.templateId, variant: b.badge.variant, accent: b.badge.accent },
        business: {
          templateId: b.business.templateId,
          variant: b.business.variant,
          accent: b.business.accent,
        },
        showEmployeeNumber: b.showEmployeeNumber,
        badgeVerso: b.badgeVerso,
        vcardQr: b.vcardQr,
        address: b.address ?? '',
        website: b.website ?? '',
        phone: b.phone ?? '',
        slogan: b.slogan ?? '',
      });
      setLecture({ ok: true, valeur: s });
      setBrouillon(s);
      setInfo('Réglages enregistrés.');
    } catch (err) {
      setAlerte(messageRh(err, 'Réglages non enregistrés.'));
    } finally {
      setOccupe(false);
    }
  }, []);

  if (lecture === null || (lecture.ok && brouillon === null)) {
    return <Chargement texte="Chargement des cartes…" />;
  }
  if (!lecture.ok) {
    return (
      <EchecLecture
        erreur={lecture.erreur}
        repli="Les réglages des cartes sont illisibles."
        onReessayer={() => setVersion((v) => v + 1)}
      />
    );
  }
  const b = brouillon!;
  const modeles = modelesDe(b.templates, type);
  const ks = b[type];
  const majType = (patch: Partial<CardSettingsView['badge']>) =>
    setBrouillon({ ...b, [type]: { ...ks, ...patch } });

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <IdCard aria-hidden="true" className="h-5 w-5" />
          Cartes de service et cartes de visite
        </h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          Les modèles prennent les couleurs, le logo et la police de l’identité visuelle de
          l’organisation. La carte d’un collaborateur se gère dans l’onglet « Cartes » de sa fiche.
        </p>
      </header>
      {alerte ? <Alerte>{alerte}</Alerte> : null}
      {info ? (
        <p role="status" className="text-sm text-[var(--success,inherit)]">
          {info}
        </p>
      ) : null}

      <section className={SECTION} aria-labelledby={`${id}-modeles`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-modeles`} className="text-base font-semibold">
            Modèles par défaut
          </h2>
          <div role="tablist" aria-label="Type de carte" className="flex gap-1">
            {(['badge', 'business'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={type === k}
                className={
                  type === k ? buttonClasses('primary', 'sm') : buttonClasses('secondary', 'sm')
                }
                onClick={() => setType(k)}
              >
                {LIBELLE_TYPE[k]}
              </button>
            ))}
          </div>
        </div>
        <FormGrid>
          <Field id={`${id}-variante`} label="Variante de couleur" size="md" disabled={!gerer}>
            <Select<CardVariant>
              value={ks.variant}
              onChange={(v) => majType({ variant: v })}
              options={(Object.keys(LIBELLE_VARIANTE) as CardVariant[]).map((v) => ({
                value: v,
                label: LIBELLE_VARIANTE[v],
              }))}
            />
          </Field>
          <Field
            id={`${id}-accent`}
            label="Couleur d’accent"
            size="md"
            hint="Vide : couleur principale de l’identité visuelle."
          >
            <div className="flex items-center gap-2">
              <input
                id={`${id}-accent`}
                type="color"
                className="h-9 w-12 rounded-[var(--radius-sm)] border border-[var(--border-strong)] max-sm:h-11"
                value={ks.accent ?? '#1f4e79'}
                disabled={!gerer}
                aria-describedby={`${id}-accent-aide`}
                onChange={(e) => majType({ accent: e.target.value.toLowerCase() })}
              />
              {ks.accent ? (
                <button
                  type="button"
                  className={BOUTON_PETIT}
                  disabled={!gerer}
                  onClick={() => majType({ accent: null })}
                >
                  Suivre l’identité
                </button>
              ) : null}
            </div>
          </Field>
        </FormGrid>
        <p className="text-xs text-[var(--foreground-muted)]">
          Les aperçus utilisent un collaborateur fictif. Les modèles enregistrés s’appliquent après
          « Enregistrer ».
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {modeles.map((m) => (
            <Vignette
              key={m.id}
              modele={m}
              variante={ks.variant}
              version={lecture.valeur.revision}
              choisi={ks.templateId === m.id}
              onChoisir={gerer ? () => majType({ templateId: m.id }) : null}
            />
          ))}
        </div>
      </section>

      <section className={SECTION} aria-labelledby={`${id}-contenu`}>
        <h2 id={`${id}-contenu`} className="text-base font-semibold">
          Contenu imprimé
        </h2>
        <FormGrid>
          {(
            [
              ['address', 'Adresse de l’organisation', 'full'],
              ['website', 'Site', 'md'],
              ['phone', 'Téléphone de l’organisation', 'md'],
              ['slogan', 'Slogan', 'lg'],
            ] as const
          ).map(([k, label, taille]) => (
            <Field
              key={k}
              id={`${id}-${k}`}
              label={label}
              size={taille}
              newRow={k === 'slogan'}
              disabled={!gerer}
            >
              <TextInput
                maxLength={160}
                value={b[k] ?? ''}
                inputMode={k === 'website' ? 'url' : k === 'phone' ? 'tel' : undefined}
                onChange={(e) => setBrouillon({ ...b, [k]: e.target.value })}
              />
            </Field>
          ))}
        </FormGrid>
        <div className="flex flex-col gap-3">
          {(
            [
              ['showEmployeeNumber', 'Imprimer le matricule (s’il est renseigné)'],
              ['badgeVerso', 'Verso de la carte de service (restitution, grand QR)'],
              ['vcardQr', 'QR de contact (vCard) au verso de la carte de visite'],
            ] as const
          ).map(([k, label]) => (
            <Switch
              key={k}
              label={label}
              checked={b[k]}
              disabled={!gerer}
              onChange={(v) => setBrouillon({ ...b, [k]: v })}
            />
          ))}
        </div>
        {gerer ? (
          <div>
            <button
              type="button"
              className={buttonClasses('primary', 'sm')}
              disabled={occupe}
              onClick={() => void enregistrer(b)}
            >
              Enregistrer
            </button>
          </div>
        ) : null}
      </section>

      <Lot type={type} />

      <SurMesure gerer={gerer} onInstalle={() => setVersion((v) => v + 1)} />
    </section>
  );
}

function Lot({ type }: { type: CardKind }): React.ReactElement {
  const id = useId();
  const [liste, setListe] = useState<HrEmployeeListItem[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [format, setFormat] = useState<CardBatchFormat>('pdf');
  const [q, setQ] = useState('');
  const [alerte, setAlerte] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);

  useEffect(() => {
    let annule = false;
    void hrApi
      .listEmployees({ status: 'active', limit: 100, ...(q ? { q } : {}) })
      .then((p) => {
        if (!annule) setListe(p.items);
      })
      .catch(() => {
        if (!annule) setListe([]);
      });
    return () => {
      annule = true;
    };
  }, [q]);

  const tous = useMemo(() => (liste ?? []).map((e) => e.id), [liste]);

  async function generer(): Promise<void> {
    setAlerte(null);
    setOccupe(true);
    try {
      const f = await hrCardsApi.batch({ kind: type, format, employeeIds: sel });
      enregistrerFichier(f.blob, f.nom);
    } catch (err) {
      setAlerte(messageExport(err));
    } finally {
      setOccupe(false);
    }
  }

  return (
    <section className={SECTION} aria-labelledby={`${id}-lot`}>
      <h2 id={`${id}-lot`} className="text-base font-semibold">
        Génération par lot — {LIBELLE_TYPE[type].toLowerCase()}
      </h2>
      {alerte ? <Alerte>{alerte}</Alerte> : null}
      <FormGrid>
        <Field id={`${id}-q`} label="Rechercher un collaborateur" size="md">
          <TextInput type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field id={`${id}-format`} label="Format" size="lg">
          <Select<CardBatchFormat>
            value={format}
            onChange={setFormat}
            options={[
              {
                value: 'pdf',
                label: 'PDF, une page par face',
                description: 'Imprimeur, imprimante à cartes.',
              },
              {
                value: 'sheet',
                label: 'Planche A4 avec traits de coupe',
                description: 'Imprimante de bureau.',
              },
              { value: 'png-zip', label: 'Archive ZIP de PNG 300 dpi' },
            ]}
          />
        </Field>
      </FormGrid>
      {liste === null ? (
        <Chargement texte="Chargement des collaborateurs…" />
      ) : (
        <div className="max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--border)]">
          <Checkbox
            className="border-b border-[var(--border)] px-3 py-2"
            label={<span className="font-medium">Tout sélectionner ({tous.length})</span>}
            checked={tous.length > 0 && tous.every((x) => sel.includes(x))}
            indeterminate={sel.length > 0 && !tous.every((x) => sel.includes(x))}
            onChange={(coche) => setSel(coche ? tous.slice(0, 100) : [])}
          />
          {liste.map((e) => (
            <Checkbox
              key={e.id}
              className="px-3 py-1.5"
              label={
                <>
                  {nomAffiche(e)}{' '}
                  <span className="text-[var(--foreground-muted)]">{e.jobTitle}</span>
                </>
              }
              checked={sel.includes(e.id)}
              onChange={() => setSel((s) => basculerSelection(s, e.id))}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={buttonClasses('primary', 'sm')}
          disabled={occupe || sel.length === 0}
          onClick={() => void generer()}
        >
          <Download aria-hidden="true" className="h-4 w-4" />
          Générer ({sel.length})
        </button>
        <span className="text-xs text-[var(--foreground-muted)]">
          100 collaborateurs au plus par lot. Une carte de service doit avoir été émise.
        </span>
      </div>
    </section>
  );
}

function SurMesure({
  gerer,
  onInstalle,
}: {
  gerer: boolean;
  onInstalle: () => void;
}): React.ReactElement {
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<string[]>([]);
  const [info, setInfo] = useState<string | null>(null);

  async function installer(f: File): Promise<void> {
    setAlerte(null);
    setErreurs([]);
    setInfo(null);
    try {
      const r = await hrCardsApi.installPackage(f);
      setInfo(
        r.created
          ? `Modèle « ${r.installed.name} » ${r.installed.version} installé : il apparaît dans les modèles.`
          : `Cette version de « ${r.installed.name} » était déjà installée.`,
      );
      onInstalle();
    } catch (err) {
      const d = (
        err as {
          detail?: {
            details?: {
              report?: { errors?: Array<{ message: string; file?: string; line?: number }> };
            };
          };
        }
      ).detail;
      const errs = d?.details?.report?.errors ?? [];
      setErreurs(
        errs.map((x) => `${x.file ? `${x.file}${x.line ? `:${x.line}` : ''} — ` : ''}${x.message}`),
      );
      setAlerte(messageRh(err, 'Modèle refusé.'));
    }
  }

  return (
    <section className={SECTION} aria-labelledby={`${id}-sm`}>
      <h2 id={`${id}-sm`} className="text-base font-semibold">
        Modèles sur mesure
      </h2>
      <p className="text-sm text-[var(--foreground-muted)]">
        Deux façons d’obtenir une carte à votre image : un <strong>paquet code</strong> (HTML et CSS
        à variables, écrit par un développeur ou une IA) ou un <strong>gabarit de graphiste</strong>
        (fonds Illustrator ou Photoshop exportés en PNG 300 dpi et zones nommées). Le QR de
        vérification est toujours posé par Lalanda.
      </p>
      <ul className="flex flex-col gap-1 text-sm">
        <li>
          <a
            className="underline underline-offset-2"
            href="/guides/cartes-guide-paquet-code.md"
            download
          >
            Guide du paquet code (développeur, IA)
          </a>
        </li>
        <li>
          <a
            className="underline underline-offset-2"
            href="/guides/cartes-guide-graphiste.md"
            download
          >
            Guide du gabarit graphiste (Illustrator, Photoshop)
          </a>
        </li>
      </ul>
      {alerte ? (
        <Alerte>
          <span>{alerte}</span>
          {erreurs.length > 0 ? (
            <ul className="list-disc pl-5">
              {erreurs.slice(0, 20).map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
          ) : null}
        </Alerte>
      ) : null}
      {info ? (
        <p role="status" className="text-sm">
          {info}
        </p>
      ) : null}
      {gerer ? (
        <div>
          <input
            ref={ref}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label="Choisir l’archive du modèle"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void installer(f);
            }}
          />
          <button type="button" className={BOUTON_PETIT} onClick={() => ref.current?.click()}>
            <Upload aria-hidden="true" className="mr-1 inline h-3.5 w-3.5" />
            Installer un modèle (.zip)
          </button>
          <FileArchive
            aria-hidden="true"
            className="ml-2 inline h-4 w-4 text-[var(--foreground-muted)]"
          />
        </div>
      ) : null}
    </section>
  );
}
