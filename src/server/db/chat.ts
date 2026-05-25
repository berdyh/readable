import type { PoolClient } from "pg";

import { ensureSchema } from "./migrate";
import { withPgClient } from "./postgres";
import type { ChatMessageRecord, ChatSessionRecord } from "./types";

export class ChatSessionOwnershipError extends Error {
  constructor() {
    super("Chat session does not belong to the authenticated user.");
    this.name = "ChatSessionOwnershipError";
  }
}

interface ChatSessionRow {
  session_id: string;
  paper_id: string;
  user_id: string;
  created_at: Date | string | number;
  updated_at: Date | string | number;
}

interface ChatMessageRow {
  session_id: string;
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: unknown;
  reasoning: string | null;
  created_at: Date | string | number;
}

function toEpochMillis(value: Date | string | number): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return value;
  }
  return new Date(value).getTime();
}

function toTimestamp(value: number | undefined): Date {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return new Date();
  }
  return new Date(value);
}

function mapMessageRow(row: ChatMessageRow): ChatMessageRecord {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    citations: Array.isArray(row.citations) ? row.citations : undefined,
    reasoning: row.reasoning ?? undefined,
    createdAt: toEpochMillis(row.created_at),
  };
}

async function ensureOwnedChatSession(
  client: PoolClient,
  userId: string,
  paperId: string,
  sessionId: string,
): Promise<void> {
  const result = await client.query<{ session_id: string }>(
    `
    INSERT INTO chat_sessions (session_id, user_id, paper_id)
    VALUES ($1, $2, $3)
    ON CONFLICT (session_id) DO UPDATE SET
      updated_at = NOW()
    WHERE chat_sessions.user_id = EXCLUDED.user_id
      AND chat_sessions.paper_id = EXCLUDED.paper_id
    RETURNING session_id
    `,
    [sessionId, userId, paperId],
  );

  if (result.rowCount !== 1) {
    throw new ChatSessionOwnershipError();
  }
}

export async function createChatSession(
  userId: string,
  paperId: string,
  sessionId: string,
): Promise<ChatSessionRecord> {
  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<ChatSessionRow>(
      `
      INSERT INTO chat_sessions (session_id, user_id, paper_id)
      VALUES ($1, $2, $3)
      RETURNING session_id, paper_id, user_id, created_at, updated_at
      `,
      [sessionId, userId, paperId],
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create chat session.");
    }
    return {
      sessionId: row.session_id,
      paperId: row.paper_id,
      userId: row.user_id,
      messages: [],
      createdAt: toEpochMillis(row.created_at),
      updatedAt: toEpochMillis(row.updated_at),
    };
  });
}

export async function saveChatMessages(
  userId: string,
  paperId: string,
  sessionId: string,
  messages: ChatMessageRecord[],
): Promise<number> {
  if (messages.length === 0) {
    return 0;
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    await client.query("BEGIN");
    try {
      await ensureOwnedChatSession(client, userId, paperId, sessionId);

      let saved = 0;
      for (const message of messages) {
        const result = await client.query(
          `
          INSERT INTO chat_messages (
            session_id,
            id,
            user_id,
            paper_id,
            role,
            content,
            citations,
            reasoning,
            created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (session_id, id) DO UPDATE SET
            role = EXCLUDED.role,
            content = EXCLUDED.content,
            citations = EXCLUDED.citations,
            reasoning = EXCLUDED.reasoning,
            created_at = EXCLUDED.created_at
          `,
          [
            sessionId,
            message.id,
            userId,
            paperId,
            message.role,
            message.content,
            message.citations ? JSON.stringify(message.citations) : null,
            message.reasoning ?? null,
            toTimestamp(message.createdAt),
          ],
        );
        saved += result.rowCount ?? 0;
      }

      await client.query(
        `
        UPDATE chat_sessions
           SET updated_at = NOW()
         WHERE session_id = $1
           AND user_id = $2
           AND paper_id = $3
        `,
        [sessionId, userId, paperId],
      );

      const { rows } = await client.query<{ count: string }>(
        `
        SELECT COUNT(*)::text AS count
          FROM chat_messages
         WHERE session_id = $1
           AND user_id = $2
        `,
        [sessionId, userId],
      );

      await client.query("COMMIT");
      return Number(rows[0]?.count ?? saved);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function getChatMessagesForSession(
  userId: string,
  sessionId: string,
): Promise<ChatMessageRecord[]> {
  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<ChatMessageRow>(
      `
      SELECT messages.session_id, messages.id, messages.role, messages.content,
             messages.citations, messages.reasoning, messages.created_at
        FROM chat_messages messages
        JOIN chat_sessions sessions
          ON sessions.session_id = messages.session_id
       WHERE messages.session_id = $1
         AND sessions.user_id = $2
         AND messages.user_id = $2
       ORDER BY messages.created_at ASC
      `,
      [sessionId, userId],
    );
    return rows.map(mapMessageRow);
  });
}

export async function listChatSessionsForPaper(
  userId: string,
  paperId: string,
): Promise<ChatSessionRecord[]> {
  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows: sessionRows } = await client.query<ChatSessionRow>(
      `
      SELECT session_id, paper_id, user_id, created_at, updated_at
        FROM chat_sessions
       WHERE user_id = $1
         AND paper_id = $2
       ORDER BY updated_at DESC
      `,
      [userId, paperId],
    );

    if (sessionRows.length === 0) {
      return [];
    }

    const sessionIds = sessionRows.map((row) => row.session_id);
    const { rows: messageRows } = await client.query<ChatMessageRow>(
      `
      SELECT session_id, id, role, content, citations, reasoning, created_at
        FROM chat_messages
       WHERE user_id = $1
         AND session_id = ANY($2::text[])
       ORDER BY created_at ASC
      `,
      [userId, sessionIds],
    );

    const messagesBySession = new Map<string, ChatMessageRecord[]>();
    for (const message of messageRows) {
      const messages = messagesBySession.get(message.session_id) ?? [];
      messages.push(mapMessageRow(message));
      messagesBySession.set(message.session_id, messages);
    }

    return sessionRows.map((row) => ({
      sessionId: row.session_id,
      paperId: row.paper_id,
      userId: row.user_id,
      messages: messagesBySession.get(row.session_id) ?? [],
      createdAt: toEpochMillis(row.created_at),
      updatedAt: toEpochMillis(row.updated_at),
    }));
  });
}

export async function deleteChatSession(userId: string, sessionId: string): Promise<boolean> {
  await ensureSchema();

  return withPgClient(async (client) => {
    const result = await client.query(
      `
      DELETE FROM chat_sessions
       WHERE user_id = $1
         AND session_id = $2
      `,
      [userId, sessionId],
    );
    return (result.rowCount ?? 0) > 0;
  });
}
