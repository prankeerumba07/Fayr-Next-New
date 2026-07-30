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
import { CurrentStaff } from '../admin/decorators/current-staff.decorator';
import { Roles } from '../admin/decorators/roles.decorator';
import { RolesGuard } from '../admin/guards/roles.guard';
import { StaffAuthGuard } from '../admin/guards/staff-auth.guard';
import type { AuthenticatedStaff } from '../admin/staff.types';
import { ListQuestionsQueryDto } from './dto/list-questions.query';
import { ReplyDto } from './dto/reply.dto';
import { SupportQuestionService } from './support-question.service';
import type { QuestionWithUserResponse } from './support.response';

/**
 * The staff-facing side of support questions, under the guarded /admin namespace.
 * SUPPORT owns this (ADMIN via the super-role); FINANCE/OPERATIONS cannot triage
 * or answer. Replying and closing are audited (they act on a user's thread).
 * Staff see the raising user alongside each thread.
 */
@Controller('admin/questions')
@UseGuards(StaffAuthGuard, RolesGuard)
@Roles('SUPPORT')
export class AdminQuestionsController {
  constructor(private readonly support: SupportQuestionService) {}

  @Get()
  list(
    @Query() query: ListQuestionsQueryDto,
  ): Promise<QuestionWithUserResponse[]> {
    return this.support.listAll(query.status);
  }

  @Get(':id')
  get(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuestionWithUserResponse> {
    return this.support.getById(id);
  }

  @Post(':id/reply')
  reply(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ): Promise<QuestionWithUserResponse> {
    return this.support.addStaffReply(staff.id, id, dto.body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentStaff() staff: AuthenticatedStaff,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuestionWithUserResponse> {
    return this.support.close(staff.id, id);
  }
}
