import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ClaimDto } from './dto/claim.dto';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { TaskService } from './task.service';
import type { TaskResponse } from './task.response';

/**
 * The task loop. Every route is authenticated and scoped to the caller's OWN
 * tasks (a task that isn't theirs reads as 404, never leaking its existence).
 * The state transitions map 1:1 to the ported engine handlers; money in every
 * response is paise-as-strings.
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard)
export class TaskController {
  constructor(private readonly tasks: TaskService) {}

  /** Claim a campaign: deduct tickets + create the task. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClaimDto,
  ): Promise<TaskResponse> {
    return this.tasks.claim(user.id, dto.campaignId);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<TaskResponse[]> {
    return this.tasks.listForUser(user.id);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.getForUser(user.id, id);
  }

  /** Submit on-device evidence → advances purchase/delivery, records the review. */
  @Post(':id/evidence')
  @HttpCode(HttpStatus.OK)
  submitEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SubmitEvidenceDto,
  ): Promise<TaskResponse> {
    return this.tasks.submitEvidence(user.id, id, dto);
  }

  @Post(':id/confirm-order')
  @HttpCode(HttpStatus.OK)
  confirmOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.confirmOrder(user.id, id);
  }

  @Post(':id/reviewed')
  @HttpCode(HttpStatus.OK)
  markReviewed(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.markReviewed(user.id, id);
  }

  @Post(':id/start-hold')
  @HttpCode(HttpStatus.OK)
  startHold(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.startHold(user.id, id);
  }

  /** Release the refund (eligibility-gated). Normally the 1.6 scheduler drives this. */
  @Post(':id/release-refund')
  @HttpCode(HttpStatus.OK)
  releaseRefund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.releaseRefund(user.id, id);
  }
}
