import { IsIn, IsISO8601, IsOptional } from 'class-validator';

/**
 * Query for every /admin/reports/* endpoint: an optional date range (defaults to
 * the last 30 days), an optional bucket granularity for the time-series reports,
 * and an optional `format=xlsx` to get the Excel download instead of JSON.
 *
 * `from`/`to` accept a date (YYYY-MM-DD) or a full ISO timestamp; the service
 * floors `from` to the start of its UTC day and ceils `to` to the end of its UTC
 * day, so the range is always inclusive on both ends.
 */
export class ReportRangeQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(['day', 'week'])
  granularity?: 'day' | 'week';

  @IsOptional()
  @IsIn(['xlsx'])
  format?: 'xlsx';
}
