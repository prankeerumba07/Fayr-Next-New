import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

@Module({
  // AuthModule for JwtAuthGuard, PrismaModule for the one table this owns.
  // Deliberately NOT TaskModule: nothing here starts a transition, and importing
  // it would put the task engine one autocomplete away from this service.
  imports: [AuthModule, PrismaModule],
  controllers: [ReviewController],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}
