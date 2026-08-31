import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AssistantModule } from '../assistant/assistant.module';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminChatController } from './admin-chat.controller';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatStore } from './chat.store';

/**
 * Conversations: both sides of one.
 *
 * A layer on top of the assistant rather than beside it — AssistantModule is
 * imported for the answer engine, and nothing in the assistant imports this, so
 * the dependency runs one way and the older code is unchanged by any of it.
 */
@Module({
  imports: [PrismaModule, AssistantModule, AdminModule, AuthModule],
  controllers: [AdminChatController, ChatController],
  providers: [ChatStore, ChatService],
  exports: [ChatStore, ChatService],
})
export class ChatModule {}
