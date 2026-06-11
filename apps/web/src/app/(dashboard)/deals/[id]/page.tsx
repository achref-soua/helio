import { DealDetail } from './deal-detail';

export default async function DealDetailPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  return <DealDetail dealId={id} />;
}
