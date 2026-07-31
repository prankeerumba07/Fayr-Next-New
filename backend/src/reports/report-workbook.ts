import { Workbook, type Worksheet } from 'exceljs';
import type {
  ActivityReport,
  CampaignPerfReport,
  PayoutsReport,
  ReportRange,
  UserGrowthReport,
} from './report.types';

/** Money for a spreadsheet is a rupee NUMBER (so it sums/filters), not a string. */
const rupees = (paise: string): number => Number(paise) / 100;
const RUPEE_FMT = '#,##0.00';
const dayOnly = (iso: string): string => iso.slice(0, 10);

/** Bold the header row and freeze it so it stays visible while scrolling. */
function styleHeader(ws: Worksheet): void {
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** A small "Report / from / to / granularity" band at the top of a summary sheet. */
function rangeBand(ws: Worksheet, title: string, range: ReportRange): void {
  ws.addRow(['Report', title]);
  ws.addRow(['From', dayOnly(range.from)]);
  ws.addRow(['To', dayOnly(range.to)]);
  ws.addRow(['Granularity', range.granularity]);
  ws.addRow([]);
  ws.getColumn(1).font = { bold: true };
  ws.getColumn(1).width = 18;
  ws.getColumn(2).width = 32;
}

export async function campaignsWorkbook(
  r: CampaignPerfReport,
): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'Fayr';

  const summary = wb.addWorksheet('Summary');
  rangeBand(summary, 'Campaign / offers performance', r.range);
  summary.addRow(['Campaigns', r.totals.campaigns]);
  summary.addRow(['Claims', r.totals.claims]);
  summary.addRow(['Purchases', r.totals.purchases]);
  summary.addRow(['Reviews', r.totals.reviews]);
  summary.addRow(['Refunds', r.totals.refunds]);

  const ws = wb.addWorksheet('Campaigns');
  ws.columns = [
    { header: 'Title', key: 'title', width: 40 },
    { header: 'Platform', key: 'platform', width: 12 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Slots', key: 'slots', width: 8 },
    { header: 'Claims', key: 'claims', width: 9 },
    { header: 'Purchases', key: 'purchases', width: 11 },
    { header: 'Reviews', key: 'reviews', width: 9 },
    { header: 'Refunds', key: 'refunds', width: 9 },
    { header: 'Expired', key: 'expired', width: 9 },
    { header: 'Purchase %', key: 'pc', width: 12 },
    { header: 'Refund %', key: 'rc', width: 11 },
    { header: 'Fill %', key: 'fill', width: 9 },
  ];
  for (const row of r.rows) {
    ws.addRow({
      title: row.title,
      platform: row.platform,
      status: row.status,
      slots: row.totalSlots ?? '',
      claims: row.claims,
      purchases: row.purchases,
      reviews: row.reviews,
      refunds: row.refunds,
      expired: row.expired,
      pc: row.purchaseConversionPct,
      rc: row.refundConversionPct,
      fill: row.fillRatePct ?? '',
    });
  }
  styleHeader(ws);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function payoutsWorkbook(r: PayoutsReport): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'Fayr';

  const summary = wb.addWorksheet('Summary');
  rangeBand(summary, 'Payouts / financial', r.range);
  const money = (label: string, paise: string): void => {
    const row = summary.addRow([label, rupees(paise)]);
    row.getCell(2).numFmt = RUPEE_FMT;
  };
  money('Refunds credited (₹)', r.refundsCreditedPaise);
  summary.addRow(['Refunds credited (count)', r.refundsCreditedCount]);
  money('Paid out (₹)', r.paidOutPaise);
  summary.addRow(['Payouts marked paid (count)', r.paidOutCount]);
  summary.addRow(['Completion grants', r.completionGrants]);
  summary.addRow(['Completion tickets granted', r.completionTicketsTotal]);

  const byStatus = wb.addWorksheet('Withdrawals by status');
  byStatus.columns = [
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Count', key: 'count', width: 10 },
    { header: 'Total (₹)', key: 'total', width: 16 },
  ];
  for (const s of r.withdrawalsByStatus) {
    const row = byStatus.addRow({
      status: s.status,
      count: s.count,
      total: rupees(s.totalPaise),
    });
    row.getCell(3).numFmt = RUPEE_FMT;
  }
  styleHeader(byStatus);

  const trend = wb.addWorksheet('Trend');
  trend.columns = [
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Refunds (₹)', key: 'refunds', width: 16 },
    { header: 'Paid out (₹)', key: 'paid', width: 16 },
  ];
  for (const p of r.series) {
    const row = trend.addRow({
      bucket: p.bucket,
      refunds: rupees(p.refundsPaise),
      paid: rupees(p.paidOutPaise),
    });
    row.getCell(2).numFmt = RUPEE_FMT;
    row.getCell(3).numFmt = RUPEE_FMT;
  }
  styleHeader(trend);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function activityWorkbook(r: ActivityReport): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'Fayr';

  const funnel = wb.addWorksheet('Funnel');
  rangeBand(funnel, 'Activity funnel (tasks created in range)', r.range);
  funnel.addRow(['Claimed', r.funnel.claimed]);
  funnel.addRow(['Purchased', r.funnel.purchased]);
  funnel.addRow(['Delivered', r.funnel.delivered]);
  funnel.addRow(['Reviewed', r.funnel.reviewed]);
  funnel.addRow(['In holding', r.funnel.holding]);
  funnel.addRow(['Refunded', r.funnel.refunded]);
  funnel.addRow(['Expired (unpurchased)', r.funnel.expired]);

  const trend = wb.addWorksheet('Trend');
  trend.columns = [
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Claims', key: 'claims', width: 10 },
    { header: 'Refunds', key: 'refunds', width: 10 },
  ];
  for (const p of r.series) trend.addRow(p);
  styleHeader(trend);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function usersWorkbook(r: UserGrowthReport): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'Fayr';

  const summary = wb.addWorksheet('Summary');
  rangeBand(summary, 'User growth', r.range);
  summary.addRow(['New signups', r.newSignups]);
  summary.addRow(['Active claimers', r.activeClaimers]);
  summary.addRow(['Cumulative users', r.cumulativeUsers]);

  const trend = wb.addWorksheet('Trend');
  trend.columns = [
    { header: 'Bucket', key: 'bucket', width: 14 },
    { header: 'Signups', key: 'signups', width: 10 },
    { header: 'Active claimers', key: 'activeClaimers', width: 16 },
    { header: 'Cumulative', key: 'cumulative', width: 12 },
  ];
  for (const p of r.series) trend.addRow(p);
  styleHeader(trend);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
