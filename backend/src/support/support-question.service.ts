import { Injectable, NotFoundException } from '@nestjs/common';
import type { QuestionStatus } from '@prisma/client';
import { AdminAuditService } from '../admin/admin-audit.service';
import { AUDIT_ACTIONS } from '../admin/admin.constants';
import { PrismaService } from '../prisma/prisma.service';
import {
  toQuestionResponse,
  toQuestionWithUser,
  type QuestionResponse,
  type QuestionWithUserResponse,
} from './support.response';

const REPLIES_NEWEST_LAST = {
  replies: { orderBy: { createdAt: 'asc' } },
} as const;

/**
 * Support questions: the user side (submit + follow up + read own) and the staff
 * side (list + read + answer + close). Status tracks who's waiting — a user
 * follow-up re-OPENs, a staff answer moves it to ANSWERED. Every STAFF action is
 * audited (it touches a user's thread); user actions on their own threads are not.
 */
@Injectable()
export class SupportQuestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
  ) {}

  // ---- user side ----------------------------------------------------------

  async create(
    userId: string,
    subject: string,
    body: string,
  ): Promise<QuestionResponse> {
    const q = await this.prisma.supportQuestion.create({
      data: { userId, subject, body },
      include: REPLIES_NEWEST_LAST,
    });
    return toQuestionResponse(q);
  }

  async listForUser(userId: string): Promise<QuestionResponse[]> {
    const rows = await this.prisma.supportQuestion.findMany({
      where: { userId },
      include: REPLIES_NEWEST_LAST,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toQuestionResponse);
  }

  async getForUser(
    userId: string,
    questionId: string,
  ): Promise<QuestionResponse> {
    const q = await this.ownedOr404(userId, questionId);
    return toQuestionResponse(q);
  }

  /** A user follow-up on their own thread. Re-OPENs (staff must look again). */
  async addUserReply(
    userId: string,
    questionId: string,
    body: string,
  ): Promise<QuestionResponse> {
    await this.ownedOr404(userId, questionId);
    const q = await this.prisma.supportQuestion.update({
      where: { id: questionId },
      data: {
        status: 'OPEN',
        replies: { create: { body, staffUserId: null } },
      },
      include: REPLIES_NEWEST_LAST,
    });
    return toQuestionResponse(q);
  }

  // ---- staff side ---------------------------------------------------------

  async listAll(status?: QuestionStatus): Promise<QuestionWithUserResponse[]> {
    const rows = await this.prisma.supportQuestion.findMany({
      where: status ? { status } : undefined,
      include: { ...REPLIES_NEWEST_LAST, user: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toQuestionWithUser);
  }

  async getById(questionId: string): Promise<QuestionWithUserResponse> {
    const q = await this.prisma.supportQuestion.findUnique({
      where: { id: questionId },
      include: { ...REPLIES_NEWEST_LAST, user: true },
    });
    if (!q) throw new NotFoundException('Question not found');
    return toQuestionWithUser(q);
  }

  /** A staff answer. Moves the thread to ANSWERED and audits the reply. */
  async addStaffReply(
    staffUserId: string,
    questionId: string,
    body: string,
  ): Promise<QuestionWithUserResponse> {
    const existing = await this.prisma.supportQuestion.findUnique({
      where: { id: questionId },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const q = await this.prisma.supportQuestion.update({
      where: { id: questionId },
      data: {
        status: 'ANSWERED',
        replies: { create: { body, staffUserId } },
      },
      include: { ...REPLIES_NEWEST_LAST, user: true },
    });
    await this.audit.record({
      staffUserId,
      action: AUDIT_ACTIONS.QUESTION_REPLY,
      targetUserId: existing.userId,
      metadata: { questionId },
    });
    return toQuestionWithUser(q);
  }

  /** Staff marks a thread resolved. Audited. */
  async close(
    staffUserId: string,
    questionId: string,
  ): Promise<QuestionWithUserResponse> {
    const existing = await this.prisma.supportQuestion.findUnique({
      where: { id: questionId },
    });
    if (!existing) throw new NotFoundException('Question not found');

    const q = await this.prisma.supportQuestion.update({
      where: { id: questionId },
      data: { status: 'CLOSED' },
      include: { ...REPLIES_NEWEST_LAST, user: true },
    });
    await this.audit.record({
      staffUserId,
      action: AUDIT_ACTIONS.QUESTION_CLOSE,
      targetUserId: existing.userId,
      metadata: { questionId },
    });
    return toQuestionWithUser(q);
  }

  // ---- helpers ------------------------------------------------------------

  private async ownedOr404(userId: string, questionId: string) {
    const q = await this.prisma.supportQuestion.findUnique({
      where: { id: questionId },
      include: REPLIES_NEWEST_LAST,
    });
    // One 404 for "missing" and "not yours" alike — never reveal another user's
    // question exists.
    if (!q || q.userId !== userId) {
      throw new NotFoundException('Question not found');
    }
    return q;
  }
}
