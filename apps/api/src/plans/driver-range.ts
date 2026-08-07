// Contrôle des bornes `min`/`max` déclarées par le DSL (S18c — revue CTO B1).
//
// Le wizard web a cessé d'écrêter silencieusement les saisies (docs/06-WIZARD.md :
// une valeur hors bornes doit être visible et signalée, pas corrigée dans le dos de
// l'utilisateur). La persistance d'une valeur hors bornes reste donc autorisée — c'est
// un brouillon de travail. En revanche **figer un plan validé** est un acte officiel :
// un chiffre montré à une banque ne peut pas violer les bornes du modèle.
//
// Ce module porte cette règle côté serveur, seule autorité. Un bouton `disabled` en
// React n'est pas un garde-fou (docs/26 : aucune règle financière dans un composant UI).

import type { Template } from '@lalanda/engine';

export interface DriverRangeViolation {
  driverId: string;
  label?: string;
  value: number;
  min?: number;
  max?: number;
}

/**
 * Liste les drivers dont la valeur sort des bornes déclarées par le template.
 *
 * Seules les valeurs **effectivement fournies** sont contrôlées : un driver absent
 * prendra la valeur du ParameterPack ou le défaut du template, tous deux maîtrisés
 * en amont. Un driver inconnu du template est ignoré ici — le moteur le signalera.
 */
export function findDriverRangeViolations(
  template: Template,
  values: Record<string, number>,
): DriverRangeViolation[] {
  const violations: DriverRangeViolation[] = [];
  for (const driver of template.drivers) {
    if (!Object.prototype.hasOwnProperty.call(values, driver.id)) continue;
    const value = values[driver.id];
    if (value === undefined) continue;

    const tropBas = driver.min !== undefined && value < driver.min;
    const tropHaut = driver.max !== undefined && value > driver.max;
    // Une valeur non finie n'est comparable à aucune borne : elle est fautive par nature.
    if (!Number.isFinite(value) || tropBas || tropHaut) {
      violations.push({
        driverId: driver.id,
        ...(driver.label === undefined ? {} : { label: driver.label }),
        value,
        ...(driver.min === undefined ? {} : { min: driver.min }),
        ...(driver.max === undefined ? {} : { max: driver.max }),
      });
    }
  }
  return violations;
}
