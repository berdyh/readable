import { NextRequest, NextResponse } from "next/server";

import { answerPaperQuestion } from "@/server/qa";
import type { AnswerResult, QuestionSelection } from "@/server/qa/types";
import { parseQuestionSelection } from "@/server/qa";
import { classifyFailoverSignal } from "@/server/llm/routing";
import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";

/**
 * Local CLI agents the chat picker may pin a question to. Allowlisted rather
 * than passed through, because the value ends up selecting a binary to spawn —
 * an unvalidated string here would be the wrong kind of flexible.
 */
const LOCAL_AGENT_IDS = new Set(["claude-code", "codex-cli"]);

interface QaRequestPayload {
  paperId: string;
  question: string;
  selection?: QuestionSelection;
  localAgent?: string;
}

function parseRequestPayload(data: unknown): QaRequestPayload {
  if (!data || typeof data !== "object") {
    throw new Error("Request body must be an object.");
  }

  const payload = data as Record<string, unknown>;
  const paperIdRaw = payload.paperId;
  const questionRaw = payload.question;

  if (typeof paperIdRaw !== "string" || !paperIdRaw.trim()) {
    throw new Error('Field "paperId" is required.');
  }

  if (typeof questionRaw !== "string" || !questionRaw.trim()) {
    throw new Error('Field "question" is required.');
  }

  const result: QaRequestPayload = {
    paperId: paperIdRaw.trim(),
    question: questionRaw.trim(),
  };

  const selection = parseQuestionSelection(payload.selection);
  if (selection) {
    result.selection = selection;
  }

  const localAgent = payload.localAgent;
  if (typeof localAgent === "string" && LOCAL_AGENT_IDS.has(localAgent)) {
    result.localAgent = localAgent;
  }

  return result;
}

function mapQaError(error: unknown): { status: number; message: string; code: string } {
  const reason = classifyFailoverSignal({
    message: error instanceof Error ? error.message : error,
  });

  switch (reason) {
    case "auth":
    case "auth_permanent":
      return {
        status: 500,
        code: "provider_auth",
        message: "The configured QA provider could not authenticate. Check provider credentials.",
      };
    case "rate_limit":
      return {
        status: 429,
        code: "provider_rate_limit",
        message: "The QA provider is rate limited. Try again shortly.",
      };
    case "billing":
      return {
        status: 402,
        code: "provider_billing",
        message: "The QA provider quota or billing limit was reached.",
      };
    case "timeout":
      return {
        status: 504,
        code: "provider_timeout",
        message: "The QA provider timed out. Try again shortly.",
      };
    case "overloaded":
      return {
        status: 503,
        code: "provider_overloaded",
        message: "The QA provider is temporarily overloaded. Try again shortly.",
      };
    case "model_not_found":
      return {
        status: 500,
        code: "provider_model",
        message: "The configured QA model is not available.",
      };
    case "format":
    case "empty_response":
      return {
        status: 502,
        code: "provider_response",
        message: "The QA provider returned an unsupported response.",
      };
    default:
      return {
        status: 502,
        code: "qa_failed",
        message: "Failed to answer the question.",
      };
  }
}

function emitQaTrustCounter(result: AnswerResult) {
  console.info("[qa] trust_counter", {
    status: result.trust.status,
    hasEvidence: result.trust.hasEvidence,
    validCitationCount: result.trust.validCitationCount,
    invalidCitationCount: result.trust.invalidCitationCount,
    warningCount: result.trust.warnings.length,
    vectorStatus: result.trust.retrieval.vector.status,
    vectorHitCount: result.trust.retrieval.vector.hitCount,
    textStatus: result.trust.retrieval.text.status,
    textHitCount: result.trust.retrieval.text.hitCount,
  });
}

export async function POST(request: NextRequest) {
  let payload: QaRequestPayload;

  try {
    payload = parseRequestPayload(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const userId = await requireAuthenticatedUserId();
    const result = await answerPaperQuestion(payload.paperId, payload.question, {
      userId,
      selection: payload.selection,
      localAgent: payload.localAgent,
    });
    emitQaTrustCounter(result);

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    console.error("[qa] Failed to answer question", error);
    const mapped = mapQaError(error);
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.status },
    );
  }
}
