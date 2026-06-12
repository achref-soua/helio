/**
 * Pure sales-report math (H5). Works on plain deal shapes so the numbers
 * are unit-testable without a database; the CRM router feeds it rows and
 * renders the results.
 */

export interface SalesDeal {
  valueCents: number;
  status: 'OPEN' | 'WON' | 'LOST';
  stageName: string;
  ownerId: string | null;
  createdAt: Date;
  closedAt: Date | null;
}

/** Open pipeline value per stage, in stage order of first appearance. */
export function pipelineValueByStage(
  deals: SalesDeal[],
): Array<{ stage: string; count: number; valueCents: number }> {
  const byStage = new Map<string, { stage: string; count: number; valueCents: number }>();
  for (const deal of deals) {
    if (deal.status !== 'OPEN') continue;
    const entry = byStage.get(deal.stageName) ?? {
      stage: deal.stageName,
      count: 0,
      valueCents: 0,
    };
    entry.count += 1;
    entry.valueCents += deal.valueCents;
    byStage.set(deal.stageName, entry);
  }
  return [...byStage.values()];
}

/** Won ÷ closed (won + lost). Null until at least one deal has closed. */
export function winRate(deals: SalesDeal[]): number | null {
  const won = deals.filter((deal) => deal.status === 'WON').length;
  const lost = deals.filter((deal) => deal.status === 'LOST').length;
  const closed = won + lost;
  return closed === 0 ? null : won / closed;
}

/** Mean days from creation to close, over closed deals with a closedAt. */
export function avgCycleDays(deals: SalesDeal[]): number | null {
  const cycles = deals
    .filter((deal) => deal.status !== 'OPEN' && deal.closedAt)
    .map((deal) => (deal.closedAt!.getTime() - deal.createdAt.getTime()) / 86_400_000);
  if (cycles.length === 0) return null;
  return cycles.reduce((sum, days) => sum + days, 0) / cycles.length;
}

/**
 * Open value × the win rate to date — deliberately simple and stated as
 * such in the UI. Null until a win rate exists.
 */
export function weightedForecastCents(deals: SalesDeal[]): number | null {
  const rate = winRate(deals);
  if (rate === null) return null;
  const openValue = deals
    .filter((deal) => deal.status === 'OPEN')
    .reduce((sum, deal) => sum + deal.valueCents, 0);
  return Math.round(openValue * rate);
}

/** Won value per owner, descending; unassigned deals group under null. */
export function ownerLeaderboard(
  deals: SalesDeal[],
): Array<{ ownerId: string | null; wonCents: number; wonCount: number }> {
  const byOwner = new Map<
    string | null,
    { ownerId: string | null; wonCents: number; wonCount: number }
  >();
  for (const deal of deals) {
    if (deal.status !== 'WON') continue;
    const key = deal.ownerId;
    const entry = byOwner.get(key) ?? { ownerId: key, wonCents: 0, wonCount: 0 };
    entry.wonCents += deal.valueCents;
    entry.wonCount += 1;
    byOwner.set(key, entry);
  }
  return [...byOwner.values()].sort((a, b) => b.wonCents - a.wonCents);
}
