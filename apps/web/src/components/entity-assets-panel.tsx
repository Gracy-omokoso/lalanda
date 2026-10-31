'use client';

// Panneau « Matériel affecté » / « Équipements acquis » d'une fiche (ADR-0046
// § 6.4, § 6.5, § 6.8 ; lot S9) : `GET /assets?employeeId=` (ou `workProjectId`,
// `supplierId`), lecture `assets.read`, sans rien modifier du module hôte. Aucune
// reprise automatique : la fiche liste, la fiche équipement agit.

import { Badge } from '@lalanda/ui';
import { Laptop } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { assetsApi, type AssetView, type ListAssetsParams } from '@/lib/api-assets';

import { useShell } from '../app/(app)/_components/shell-context';
import {
  LIBELLES_STATUT,
  formatJour,
  lienEquipement,
  lire,
  peutLireEquipements,
  tonStatut,
  type Lecture,
} from '../app/(app)/equipements/_components/equipements-model';
import {
  Chargement,
  EchecLecture,
  Panneau,
  PhraseSection,
} from '../app/(app)/equipements/_components/equipements-ui';

export function EntityAssetsPanel({
  filtre,
  titre = 'Matériel affecté',
  vide = 'Aucun équipement affecté.',
  className,
}: {
  filtre: Pick<ListAssetsParams, 'employeeId' | 'workProjectId' | 'supplierId'>;
  titre?: string;
  vide?: string;
  className?: string;
}): React.ReactElement | null {
  const { actions } = useShell();
  const lireEq = peutLireEquipements(actions);
  const [lecture, setLecture] = useState<Lecture<AssetView[]> | null>(null);
  const cle = JSON.stringify(filtre);

  useEffect(() => {
    if (!lireEq) return;
    let annule = false;
    const f = JSON.parse(cle) as ListAssetsParams;
    // Matériel ACQUIS chez un fournisseur : tout le registre ; affecté : les actifs.
    const status = f.supplierId ? 'all' : 'active';
    void lire(assetsApi.list({ ...f, status, limit: 100 }).then((p) => p.items)).then((l) => {
      if (!annule) setLecture(l);
    });
    return () => {
      annule = true;
    };
  }, [lireEq, cle]);

  if (!lireEq) return null;

  return (
    <Panneau titre={titre} icone={Laptop} id={`equipements-${titre}`} className={className ?? ''}>
      {lecture === null ? (
        <Chargement />
      ) : !lecture.ok ? (
        <EchecLecture erreur={lecture.erreur} repli="Les équipements sont illisibles." />
      ) : lecture.valeur.length === 0 ? (
        <PhraseSection>{vide}</PhraseSection>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] text-sm">
          {lecture.valeur.map((a) => (
            <li key={a.id}>
              <Link
                href={lienEquipement(a.id)}
                className="flex flex-wrap items-center gap-2 py-2 hover:underline"
              >
                <span className="min-w-0 flex-1 break-words font-medium">{a.name}</span>
                <span className="text-xs text-[var(--foreground-muted)]">
                  {a.number}
                  {a.currentAssignment
                    ? ` · depuis le ${formatJour(a.currentAssignment.from)}`
                    : ''}
                </span>
                <Badge tone={tonStatut(a.status)}>{LIBELLES_STATUT[a.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panneau>
  );
}
