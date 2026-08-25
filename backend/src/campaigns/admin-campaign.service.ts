import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Campaign, CampaignStatus, Platform, Prisma } from '@prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { toCampaignResponse, type CampaignResponse } from './campaign.response';
import { claimedFor, claimedSeatsByCampaign } from './seats';
import type { CreateCampaignDto } from './dto/create-campaign.dto';
import type { UpdateCampaignDto } from './dto/update-campaign.dto';

/** A campaign may only be edited while it's a draft or paused (never live/ended). */
const EDITABLE_STATUSES: readonly CampaignStatus[] = ['DRAFT', 'PAUSED'];

/** Trim a string; treat empty (or whitespace-only) as an explicit clear → null. */
function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * Staff-facing campaign management (OPERATIONS role). This is the write side that
 * the read-only CampaignService/CampaignController never expose: create as DRAFT,
 * edit while draft/paused, and move through the lifecycle
 * (publish → pause ↔ resume → end). Every write is audited. Money is parsed from
 * decimal-string paise to BigInt here — the single place it crosses back in.
 */
@Injectable()
export class AdminCampaignService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The same operator setting the user-facing responses quote. One source. */
  private get claimWindowDays(): number {
    return this.config.get('CLAIM_TTL_DAYS', { infer: true });
  }

  /**
   * One campaign as the panel sees it, seats included.
   *
   * Two helpers rather than one because the difference is a database round trip:
   * `view` takes a count the caller already has (the list fetches every count in a
   * single query), and `viewOne` fetches one. Neither lets a call site invent the
   * number.
   */
  private view(campaign: Campaign, claimedCount: number): CampaignResponse {
    return toCampaignResponse(campaign, {
      claimWindowDays: this.claimWindowDays,
      claimedCount,
    });
  }

  private async viewOne(campaign: Campaign): Promise<CampaignResponse> {
    const taken = await claimedSeatsByCampaign(this.prisma, [campaign.id]);
    return this.view(campaign, claimedFor(taken, campaign.id));
  }

  /** Every campaign (any status), newest first, optionally filtered. */
  async listAll(
    status?: CampaignStatus,
    platform?: Platform,
  ): Promise<CampaignResponse[]> {
    const rows = await this.prisma.campaign.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(platform ? { platform } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const taken = await claimedSeatsByCampaign(this.prisma, rows.map((c) => c.id));
    return rows.map((c) => this.view(c, claimedFor(taken, c.id)));
  }

  /** One campaign by id, any status. 404 if missing. */
  async getById(id: string): Promise<CampaignResponse> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return this.viewOne(campaign);
  }

  /** Create a campaign. Always lands in DRAFT — going live is a separate step. */
  async create(
    actingStaffId: string,
    dto: CreateCampaignDto,
  ): Promise<CampaignResponse> {
    const created = await this.prisma.campaign.create({
      data: {
        platform: dto.platform,
        status: 'DRAFT', // forced — never publish straight from create
        title: dto.title.trim(),
        productName: dto.productName.trim(),
        category: dto.category?.trim() || null,
        productPricePaise: BigInt(dto.productPricePaise),
        // Undefined lets the schema defaults apply (payoutPercent 100, ticketCost 5).
        payoutPercent: dto.payoutPercent,
        payoutCapPaise: dto.payoutCapPaise
          ? BigInt(dto.payoutCapPaise)
          : undefined,
        ticketCost: dto.ticketCost,
        returnWindowDays: dto.returnWindowDays,
        minRating: dto.minRating,
        totalSlots: dto.totalSlots,
        asin: dto.asin?.trim() || null,
        productUrl: dto.productUrl?.trim() || null,
        imageUrl: dto.imageUrl?.trim() || null,
        terms: dto.terms?.trim() || null,
      },
    });
    await this.audit.record({
      staffUserId: actingStaffId,
      action: AUDIT_ACTIONS.CAMPAIGN_CREATE,
      metadata: {
        campaignId: created.id,
        title: created.title,
        platform: created.platform,
      },
    });
    return this.viewOne(created);
  }

  /** Edit a DRAFT or PAUSED campaign. Only the provided fields change. */
  async update(
    actingStaffId: string,
    id: string,
    dto: UpdateCampaignDto,
  ): Promise<CampaignResponse> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (!EDITABLE_STATUSES.includes(campaign.status)) {
      throw new ConflictException(
        campaign.status === 'ACTIVE'
          ? 'Pause the campaign before editing it'
          : 'An ended campaign can no longer be edited',
      );
    }

    const data: Prisma.CampaignUpdateInput = {};
    if (dto.platform !== undefined) data.platform = dto.platform;
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.productName !== undefined)
      data.productName = dto.productName.trim();
    if (dto.category !== undefined) data.category = emptyToNull(dto.category);
    if (dto.productPricePaise !== undefined) {
      data.productPricePaise = BigInt(dto.productPricePaise);
    }
    if (dto.payoutPercent !== undefined) data.payoutPercent = dto.payoutPercent;
    if (dto.payoutCapPaise !== undefined) {
      data.payoutCapPaise =
        dto.payoutCapPaise === '' ? null : BigInt(dto.payoutCapPaise);
    }
    if (dto.ticketCost !== undefined) data.ticketCost = dto.ticketCost;
    if (dto.returnWindowDays !== undefined) {
      data.returnWindowDays = dto.returnWindowDays;
    }
    if (dto.minRating !== undefined) data.minRating = dto.minRating;
    if (dto.totalSlots !== undefined) data.totalSlots = dto.totalSlots;
    if (dto.asin !== undefined) data.asin = emptyToNull(dto.asin);
    if (dto.productUrl !== undefined)
      data.productUrl = emptyToNull(dto.productUrl);
    if (dto.imageUrl !== undefined) data.imageUrl = emptyToNull(dto.imageUrl);
    if (dto.terms !== undefined) data.terms = emptyToNull(dto.terms);

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }

    const updated = await this.prisma.campaign.update({ where: { id }, data });
    await this.audit.record({
      staffUserId: actingStaffId,
      action: AUDIT_ACTIONS.CAMPAIGN_UPDATE,
      metadata: { campaignId: id, fields: Object.keys(data) },
    });
    return this.viewOne(updated);
  }

  /** DRAFT → ACTIVE: make the campaign live and claimable. */
  publish(actingStaffId: string, id: string): Promise<CampaignResponse> {
    return this.transition(actingStaffId, id, ['DRAFT'], 'ACTIVE', 'publish');
  }

  /** ACTIVE → PAUSED: hide from the feed; existing tasks are untouched. */
  pause(actingStaffId: string, id: string): Promise<CampaignResponse> {
    return this.transition(actingStaffId, id, ['ACTIVE'], 'PAUSED', 'pause');
  }

  /** PAUSED → ACTIVE: put a paused campaign back live. */
  resume(actingStaffId: string, id: string): Promise<CampaignResponse> {
    return this.transition(actingStaffId, id, ['PAUSED'], 'ACTIVE', 'resume');
  }

  /** DRAFT/ACTIVE/PAUSED → ENDED: retire the campaign for good (terminal). */
  end(actingStaffId: string, id: string): Promise<CampaignResponse> {
    return this.transition(
      actingStaffId,
      id,
      ['DRAFT', 'ACTIVE', 'PAUSED'],
      'ENDED',
      'end',
    );
  }

  /**
   * The one status-change primitive. Loads the campaign, checks its current
   * status is a legal source for the move (else 409), applies it, and audits the
   * from→to. Centralizing it keeps every lifecycle rule in one readable place.
   */
  private async transition(
    actingStaffId: string,
    id: string,
    from: readonly CampaignStatus[],
    to: CampaignStatus,
    action: string,
  ): Promise<CampaignResponse> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (!from.includes(campaign.status)) {
      throw new ConflictException(
        `Cannot ${action} a ${campaign.status.toLowerCase()} campaign`,
      );
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { status: to },
    });
    await this.audit.record({
      staffUserId: actingStaffId,
      action: AUDIT_ACTIONS.CAMPAIGN_STATUS,
      metadata: { campaignId: id, action, from: campaign.status, to },
    });
    return this.viewOne(updated);
  }
}
