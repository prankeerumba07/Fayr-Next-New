import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WriteReviewDto } from './dto/write-review.dto';
import { ReviewService } from './review.service';
import type { ReviewResponse } from './review.response';

/**
 * A TASK'S OWN REVIEW — the words a person wrote inside Fayr.
 *
 * Its own controller under the task's path rather than two more routes on
 * TaskController, because nothing here is part of the task loop: it starts no
 * transition, sends no evidence and moves no money. Keeping it separate is what
 * stops it drifting into that file and being read as though it were.
 *
 * Every route is authenticated and scoped to the caller's own tasks; somebody
 * else's task reads as 404 and never leaks that it exists.
 */
@Controller('tasks/:taskId/review')
@UseGuards(JwtAuthGuard)
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<ReviewResponse | null> {
    return this.reviews.read(user.id, taskId);
  }

  /** PUT and not POST: one review per task, and writing again replaces it. */
  @Put()
  @HttpCode(HttpStatus.OK)
  write(
    @CurrentUser() user: AuthenticatedUser,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Body() dto: WriteReviewDto,
  ): Promise<ReviewResponse> {
    return this.reviews.write(user.id, taskId, dto.text, dto.stars ?? null);
  }
}
