import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { Env } from '../config/env.validation';
import { CampaignService } from './campaign.service';
import { toCampaignResponse, type CampaignResponse } from './campaign.response';
import { ListCampaignsQuery } from './dto/list-campaigns.query';

/**
 * Read-only campaign endpoints. Authenticated only — a user must be logged in to
 * browse the campaigns they can claim (participation also requires a connected
 * marketplace account, enforced on-device). Money crosses the wire as strings
 * (see CampaignResponse).
 */
@Controller('campaigns')
@UseGuards(JwtAuthGuard)
export class CampaignController {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * The operator's claim window, read from the one setting the claim itself uses.
   * Read per request rather than cached so an operator changing it does not need a
   * redeploy to stop the app quoting the old number.
   */
  private get claimWindowDays(): number {
    return this.config.get('CLAIM_TTL_DAYS', { infer: true });
  }

  /** List active campaigns, optionally filtered by ?platform=. */
  @Get()
  async list(@Query() query: ListCampaignsQuery): Promise<CampaignResponse[]> {
    const rows = await this.campaigns.listActive(query.platform);
    // NOT `rows.map(toCampaignResponse)`: map calls back with (item, index), so
    // the bare form compiles and quietly passes the array index as the claim
    // window — a 0-day deadline on the first campaign.
    return rows.map((c) => toCampaignResponse(c, this.claimWindowDays));
  }

  /** Fetch one campaign by id (any status). 400 if malformed, 404 if missing. */
  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return toCampaignResponse(
      await this.campaigns.getById(id),
      this.claimWindowDays,
    );
  }
}
