import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import type { TaskResponse } from './task.response';
import { TaskService } from './task.service';

/**
 * Staff decisions on a single task. Today that is one thing: releasing a refund
 * that the one-purchase-one-refund gate is holding.
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
}
