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
  UseGuards,
} from '@nestjs/common';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { AllowDuplicateOrderDto } from './dto/allow-duplicate-order.dto';
import { AmountPreviewQuery } from './dto/amount-preview.query';
import { QuantityPreviewQuery } from './dto/quantity-preview.query';
import { SetAmountDto } from './dto/set-amount.dto';
import { SetQuantityDto } from './dto/set-quantity.dto';
import type {
  AwaitingAmountResponse,
  RefundPreviewResponse,
} from './awaiting-amount.response';
import type { TaskResponse } from './task.response';
import { TaskService } from './task.service';

/**
 * Staff decisions on a single task: releasing a refund the
 * one-purchase-one-refund gate is holding, and stating how many units an order
 * covers when the page does not say.
 *
 * The gate deliberately HOLDS rather than refuses, because a genuine multi-item
 * basket legitimately backs more than one task — an Amazon merged cart is two
 * products under one order number. That design is only honest if a human can
 * actually act on the hold; without this endpoint the user was told "a Fayr
 * reviewer needs to check it" and no reviewer had a button.
 *
 * SUPPORT, because this is an investigation ("is this really two items?"), the
 * same role that reviews OCR evidence. ADMIN passes via the super-role.
 * Deliberately NOT the user's own call: unlike CONFIRM_ORDER, the thing in doubt
 * here is exactly what the user would be motivated to assert.
 *
 * The override only clears THIS gate. Eligibility, the return window, the
 * published review, the charged amount and FINANCE-gated withdrawal all still
 * apply, and no money moves until someone releases the refund.
 */
@Controller('admin/tasks')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminTaskController {
  constructor(
    private readonly tasks: TaskService,
    private readonly audit: AdminAuditService,
  ) {}

  /**
   * The work queue. Declared BEFORE the ':id/...' routes so the literal segment
   * is never read as a task id.
   *
   * This exists so a held refund is DISCOVERABLE. A hold nobody can see is the
   * same dead end as a hold nobody can clear: the app tells the user a reviewer
   * will look at it, and until there was a queue no reviewer knew there was
   * anything to look at.
   */
  @Get('awaiting-amount')
  listAwaitingAmount(): Promise<AwaitingAmountResponse> {
    return this.tasks.listAwaitingAmount();
  }

  /**
   * What a given count would actually pay, before anyone commits to it. Read-only
   * and audit-free on purpose: it is a calculator, not a decision.
   */
  @Get(':id/quantity-preview')
  previewQuantity(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: QuantityPreviewQuery,
  ): Promise<RefundPreviewResponse> {
    return this.tasks.previewRefund(id, { quantity: query.quantity });
  }

  /** The same calculator, for a per-unit price a reviewer is considering. */
  @Get(':id/amount-preview')
  previewAmount(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: AmountPreviewQuery,
  ): Promise<RefundPreviewResponse> {
    return this.tasks.previewRefund(id, {
      unitPricePaise: BigInt(query.unitPricePaise),
    });
  }

  @Post(':id/allow-duplicate-order')
  @HttpCode(HttpStatus.OK)
  async allowDuplicateOrder(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AllowDuplicateOrderDto,
  ): Promise<TaskResponse> {
    const { task, userId, orderId } = await this.tasks.allowDuplicateOrder(id);
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.DUPLICATE_ORDER_ALLOW,
      targetUserId: userId,
      // The reason is the point of the record: months later "why was one order
      // paid twice" must be answerable without guessing.
      metadata: { taskId: id, orderId, reason: dto.reason },
    });
    return task;
  }

  /**
   * How many units the order covers, read off the order page by a person.
   *
   * The quantity rule refuses to pay a percentage of a line total without knowing
   * how many units it covers, and almost no marketplace page states one. That is
   * the right call for money, but only if a human can act on the hold — otherwise
   * the user is told a reviewer will check it and no reviewer has a button. This
   * is the button.
   *
   * SUPPORT, for the same reason as the override above: this is an investigation,
   * and it is deliberately NOT the user's own call, because the number in doubt
   * is exactly the one they would be motivated to overstate.
   */
  /**
   * What one unit cost, read off a real document by a person.
   *
   * Tighter than the count control on purpose: an amount is the only money figure
   * in the system a human invents rather than a machine reads, so it carries a
   * closed list of WHERE it was read, a ceiling derived from the campaign's price
   * and the order's total, and an explicit acknowledgement when it disagrees with
   * what the campaign says the product costs. All four gates are enforced in the
   * service, because a gate the panel enforces is a gate the next client forgets.
   */
  @Post(':id/amount')
  @HttpCode(HttpStatus.OK)
  async setAmount(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetAmountDto,
  ): Promise<TaskResponse> {
    const { task, userId, previousUnitPricePaise } =
      await this.tasks.setStaffAmount(id, {
        unitPricePaise: BigInt(dto.unitPricePaise),
        evidenceSource: dto.evidenceSource,
        acknowledgedDisagreement: dto.acknowledgedDisagreement === true,
      });
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.TASK_AMOUNT_SET,
      targetUserId: userId,
      metadata: {
        taskId: id,
        unitPricePaise: dto.unitPricePaise,
        previousUnitPricePaise,
        // WHERE, then WHAT they saw. The first is checkable by somebody else; the
        // second is why they believed it. A dispute needs both.
        evidenceSource: dto.evidenceSource,
        acknowledgedDisagreement: dto.acknowledgedDisagreement === true,
        reason: dto.reason,
      },
    });
    return task;
  }

  @Post(':id/quantity')
  @HttpCode(HttpStatus.OK)
  async setQuantity(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetQuantityDto,
  ): Promise<TaskResponse> {
    const { task, userId, previousQuantity } =
      await this.tasks.setStaffQuantity(id, dto.quantity);
    await this.audit.record({
      staffUserId: staff.id,
      action: AUDIT_ACTIONS.TASK_QUANTITY_SET,
      targetUserId: userId,
      // previousQuantity is what makes a CORRECTION legible: "changed 1 to 3" is
      // a different event from "set 3", and only one of them needs explaining.
      metadata: {
        taskId: id,
        quantity: dto.quantity,
        previousQuantity,
        reason: dto.reason,
      },
    });
    return task;
  }
}
