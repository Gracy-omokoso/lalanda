import { redirect } from 'next/navigation';

/** `/tresorerie` ouvre l'onglet « Dépenses ». */
export default function TreasuryIndex(): never {
  redirect('/tresorerie/depenses');
}
