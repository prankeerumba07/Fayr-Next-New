import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { AdminCampaignService } from './admin-campaign.service';
import type { CampaignResponse } from './campaign.response';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { ListAdminCampaignsQuery } from './dto/list-admin-campaigns.query';
import { UpdateCampaignDto } from './dto/update-campaign.dto';

/**
 * The staff campaign console. OPERATIONS owns it (ADMIN via the super-role);
 * SUPPORT/FINANCE cannot touch campaigns. This is the write side — the public
 * GET /campaigns stays read-only and ACTIVE-only. Create drafts, edit while
 * draft/paused, and drive the lifecycle with the publish/pause/resume/end verbs.
 */
@Controller('admin/campaigns')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('OPERATIONS')
export class AdminCampaignController {
  constructor(private readonly campaigns: AdminCampaignService) {}

  @Get()
  list(@Query() query: ListAdminCampaignsQuery): Promise<CampaignResponse[]> {
    return this.campaigns.listAll(query.status, query.platform);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<CampaignResponse> {
    return this.campaigns.getById(id);
  }

  @Post()
  create(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Body() dto: CreateCampaignDto,
  ): Promise<CampaignResponse> {
    return this.campaigns.create(staff.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCampaignDto,
  ): Promise<CampaignResponse> {
    return this.campaigns.update(staff.id, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return this.campaigns.publish(staff.id, id);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.OK)
  pause(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return this.campaigns.pause(staff.id, id);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return this.campaigns.resume(staff.id, id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CampaignResponse> {
    return this.campaigns.end(staff.id, id);
  }
}
