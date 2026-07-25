import { Module } from '@nestjs/common';
import { TaskModule } from '../tasks/task.module';
import {
  HttpReviewVisibilityChecker,
  REVIEW_VISIBILITY_CHECKER,
} from './review-visibility.checker';
import { SchedulerService } from './scheduler.service';

/**
 * The maintenance scheduler. Depends on TaskService (its per-task effects) and
 * binds the review-visibility checker to the real HTTP implementation — swappable
 * in one place, exactly like the SMS sender. SchedulerRegistry comes from
 * ScheduleModule.forRoot() in AppModule.
 */
@Module({
  imports: [TaskModule],
  providers: [
    SchedulerService,
    {
      provide: REVIEW_VISIBILITY_CHECKER,
      useClass: HttpReviewVisibilityChecker,
    },
  ],
  exports: [SchedulerService],
})
export class SchedulerModule {}
