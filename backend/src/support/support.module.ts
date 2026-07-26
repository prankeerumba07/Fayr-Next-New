import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AuthModule } from '../auth/auth.module';
import { AdminQuestionsController } from './admin-questions.controller';
import { SupportController } from './support.controller';
import { SupportQuestionService } from './support-question.service';

/**
 * Support questions (2.3) — both sides in one module.
 *
 * Imports AuthModule for the user JwtAuthGuard (the /questions side) and
 * AdminModule for the staff guards + AdminAuditService (the /admin/questions
 * side). The dependency is one-directional: AdminModule does NOT import this —
 * the unified user view (2.2) reads a user's questions via Prisma directly, so
 * there's no module cycle.
 */
@Module({
  imports: [AuthModule, AdminModule],
  controllers: [SupportController, AdminQuestionsController],
  providers: [SupportQuestionService],
})
export class SupportModule {}
