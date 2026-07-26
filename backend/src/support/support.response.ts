import type {
  QuestionStatus,
  SupportQuestion,
  SupportReply,
  User,
} from '@prisma/client';

/**
 * Wire shapes for support questions. A reply's author is INFERRED from
 * staffUserId: a set id means a staff member answered, null means the question's
 * own user followed up — the client never needs a separate flag.
 */

export interface ReplyResponse {
  id: string;
  body: string;
  author: 'user' | 'staff';
  staffUserId: string | null;
  createdAt: string;
}

export interface QuestionResponse {
  id: string;
  subject: string;
  body: string;
  status: QuestionStatus;
  createdAt: string;
  updatedAt: string;
  replies: ReplyResponse[];
}

/** Staff see the same thread plus who raised it. */
export interface QuestionWithUserResponse extends QuestionResponse {
  user: { id: string; displayId: string; mobile: string };
}

type QuestionWithReplies = SupportQuestion & { replies: SupportReply[] };

function toReply(r: SupportReply): ReplyResponse {
  return {
    id: r.id,
    body: r.body,
    author: r.staffUserId ? 'staff' : 'user',
    staffUserId: r.staffUserId,
    createdAt: r.createdAt.toISOString(),
  };
}

export function toQuestionResponse(q: QuestionWithReplies): QuestionResponse {
  return {
    id: q.id,
    subject: q.subject,
    body: q.body,
    status: q.status,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    replies: q.replies.map(toReply),
  };
}

export function toQuestionWithUser(
  q: QuestionWithReplies & { user: User },
): QuestionWithUserResponse {
  return {
    ...toQuestionResponse(q),
    user: { id: q.user.id, displayId: q.user.displayId, mobile: q.user.mobile },
  };
}
