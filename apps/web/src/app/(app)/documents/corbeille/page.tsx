// `/documents/corbeille` — documents archivés : restauration ou suppression.

import type { Metadata } from 'next';

import { Corbeille } from '../_components/corbeille';

export const metadata: Metadata = { title: 'Corbeille — Documents · Lalanda' };

export default function CorbeillePage(): React.ReactElement {
  return <Corbeille />;
}
