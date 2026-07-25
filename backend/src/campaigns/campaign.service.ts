import { Injectable, NotFoundException } from '@nestjs/common';
import type { Campaign, Platform } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read access to campaigns. Phase 1 is read-only (campaigns are seeded); admin
 * CRUD is a later phase. Listing shows only ACTIVE campaigns — the ones a user
 * can currently claim — while getById returns a campaign in ANY status, so a
 * task detail can still show its (possibly now-paused) campaign.
 */
@Injectable()
export class CampaignService {
  constructor(private readonly prisma: PrismaService) {}

  /** Active campaigns, newest first, optionally filtered by marketplace. */
  listActive(platform?: Platform): Promise<Campaign[]> {
    return this.prisma.campaign.findMany({
      where: { status: 'ACTIVE', ...(platform ? { platform } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** A single campaign by id, in any status. 404 if it doesn't exist. */
  async getById(id: string): Promise<Campaign> {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new NotFoundException('Campaign not found');
    }
    return campaign;
  }
}
