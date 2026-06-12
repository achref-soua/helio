import { ContactDetail } from './contact-detail';

export default async function ContactDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <ContactDetail contactId={id} />;
}
