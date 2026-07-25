import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
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
  constructor(private readonly campaigns: CampaignService) {}

  /** List active campaigns, optionally filtered by ?platform=. */
  @Get()
  async list(@Query() query: ListCampaignsQuery): Promise<CampaignResponse[]> {
    const rows = await this.campaigns.listActive(query.platform);
    return rows.map(toCampaignResponse);
  }

  /** Fetch one campaign by id (any status). 400 if malformed, 404 if missing. */
  @Get(':id')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return toCampaignResponse(await this.campaigns.getById(id));
  }
}
