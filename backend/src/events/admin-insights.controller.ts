import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { Env } from '../config/env.validation';
import { InsightsQueryDto } from './dto/insights.query';
import { InsightsService, type Insights } from './insights.service';

/**
 * HOW FAYR IS GROWING, FOR THE PEOPLE WHO RUN IT.
 *
 * SUPPORT is the role, which is the widest of the three non-admin ones and the
 * right one here: these are counts of steps, with no money in them and nobody's
 * name. Putting them behind FINANCE or ADMIN would mean the people who answer
 * shoppers all day cannot see whether shoppers are getting in, which is the one
 * group with the most use for it.
 *
 * READ ONLY. There is no route on this controller that writes anything, and
 * there should never be one: a dashboard that can change what it measures is
 * not a dashboard.
 */
@Controller('admin/insights')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminInsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The signup funnel, code delivery, and what happened to expired sessions. */
  @Get('funnel')
  async funnel(@Query() query: InsightsQueryDto): Promise<Insights> {
    const read = await this.insights.read(query.days);
    // The session length belongs to configuration, not to a query, so it is
    // stitched on here rather than read from inside the service. It is on the
    // response because a panel showing "41 sessions ran out" is not readable
    // without knowing that a session lasts 90 days.
    return {
      ...read,
      sessions: {
        ...read.sessions,
        sessionDays: this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }),
      },
    };
  }
}
