// `/crm/contacts` — contacts et prospects (ADR-0035).

import type { Metadata } from 'next';

import { ContactsPanel } from '../_components/contacts-panel';

export const metadata: Metadata = { title: 'Contacts — CRM · Lalanda' };

export default function ContactsPage(): React.ReactElement {
  return <ContactsPanel />;
}
