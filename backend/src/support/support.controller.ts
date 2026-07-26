import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ReplyDto } from './dto/reply.dto';
import { SupportQuestionService } from './support-question.service';
import type { QuestionResponse } from './support.response';

/**
 * The user-facing side of support questions. A user raises a question, follows
 * up on it, and reads their own threads — never anyone else's (every read is
 * scoped to the authenticated user, and a foreign id is a 404).
 */
@Controller('questions')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly support: SupportQuestionService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateQuestionDto,
  ): Promise<QuestionResponse> {
    return this.support.create(user.id, dto.subject, dto.body);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<QuestionResponse[]> {
    return this.support.listForUser(user.id);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<QuestionResponse> {
    return this.support.getForUser(user.id, id);
  }

  @Post(':id/replies')
  reply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReplyDto,
  ): Promise<QuestionResponse> {
    return this.support.addUserReply(user.id, id, dto.body);
  }
}
