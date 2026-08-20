import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { ListVerificationsQueryDto } from './dto/list-verifications.query';
import {
  ApproveDecisionDto,
  ReviewDecisionDto,
} from './dto/review-decision.dto';
import { StaffVerificationService } from './staff-verification.service';
import type {
  ReviewResultResponse,
  VerificationDetailResponse,
  VerificationQueueResponse,
} from './verification.response';

/**
 * The staff OCR review back office — the mandatory human gate for tier-3
 * screenshot evidence. SUPPORT reviews (ADMIN via the super-role), same guard
 * stack as the rest of the staff panel. Approve funnels an `ocr`-sourced
 * evidence fragment through the normal task pipeline; reject / request-more close
 * the case with no engine effect. Every image view + decision is audited.
 */
@Controller('admin/verifications')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class StaffVerificationController {
  constructor(private readonly service: StaffVerificationService) {}

  @Get()
  list(
    @Query() query: ListVerificationsQueryDto,
  ): Promise<VerificationQueueResponse> {
    return this.service.listQueue(query);
  }

  @Get(':id')
  getOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VerificationDetailResponse> {
    return this.service.getOne(id);
  }

  /** Stream the private screenshot (RBAC-gated, audited). */
  @Get(':id/image')
  async image(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { buffer, mimetype, filename } = await this.service.streamImage(
      staff.id,
      id,
    );
    return new StreamableFile(buffer, {
      type: mimetype,
      disposition: `inline; filename="${filename}"`,
    });
  }

  /** Approve → funnel the `ocr` evidence fragment into the task, mark APPROVED. */
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveDecisionDto,
  ): Promise<ReviewResultResponse> {
    return this.service.approve(
      staff.id,
      id,
      dto.reason,
      dto.itemPaise != null ? BigInt(dto.itemPaise) : null,
      dto.quantity ?? null,
    );
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ReviewResultResponse> {
    return this.service.reject(staff.id, id, dto.reason);
  }

  @Post(':id/request-more')
  @HttpCode(HttpStatus.OK)
  requestMore(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDecisionDto,
  ): Promise<ReviewResultResponse> {
    return this.service.requestMore(staff.id, id, dto.reason);
  }
}
