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
import { FoundOrdersDto } from './dto/found-orders.dto';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { OrderCandidatesService } from './order-candidates.service';
import type { OrderCandidateResponse } from './order-candidate.response';
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
  constructor(
    private readonly tasks: TaskService,
    private readonly candidates: OrderCandidatesService,
  ) {}

  /** Claim a campaign: deduct tickets + create the task. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  claim(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ClaimDto,
  ): Promise<TaskResponse> {
    return this.tasks.claim(user.id, dto.campaignId, {
      terms: dto.acceptedTerms,
    });
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

  /**
   * WHAT THE PHONE FOUND IN THE SHOP'S OWN LIST OF RECENT ORDERS.
   *
   * The phone can look because the person's sign in to the shop lives on the
   * device. It sends the TEXT of each order it found and nothing else: there is
   * no field for its own verdict, and the app-wide validation refuses any field
   * this route does not name, so a phone claiming a match is turned away rather
   * than quietly ignored. Every order is read and judged here.
   */
  @Post(':id/orders-found')
  @HttpCode(HttpStatus.OK)
  ordersFound(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FoundOrdersDto,
  ): Promise<OrderCandidateResponse[]> {
    return this.candidates.record(user.id, id, dto.pages);
  }

  /** The orders we have already asked about, newest first. */
  @Get(':id/orders-found')
  ordersAsked(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<OrderCandidateResponse[]> {
    return this.candidates.list(user.id, id);
  }

  /**
   * "Yes, that is mine." The evidence is built from the order the SERVER read and
   * judged, never from anything sent with the tap, and it goes down the same
   * funnel the on-device scraper uses.
   */
  @Post(':id/orders-found/:candidateId/mine')
  @HttpCode(HttpStatus.OK)
  thisOrderIsMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('candidateId', ParseUUIDPipe) candidateId: string,
  ): Promise<TaskResponse> {
    return this.candidates.chooseMine(user.id, id, candidateId);
  }

  /**
   * THEY TAPPED BUY AND ARE GOING TO THE SHOP.
   *
   * Records the tap, starts the two hour hold, and returns the task with the
   * pop-up's own words on it. The app draws the pop-up from those words rather
   * than writing its own, so what is kept and what is read are the same thing.
   *
   * Tapping twice is not an error. The second call returns the first tap's hold
   * unchanged, because a hold somebody can walk forward by tapping again is not a
   * hold. See goToShop.
   */
  @Post(':id/going-to-the-shop')
  @HttpCode(HttpStatus.OK)
  goToShop(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TaskResponse> {
    return this.tasks.goToShop(user.id, id);
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
