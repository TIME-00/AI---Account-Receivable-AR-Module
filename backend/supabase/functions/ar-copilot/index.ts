import { handleCORS, jsonResponse } from "../_shared/cors.ts";
import { extractCompanyId, getAuthContext } from "../_shared/auth.ts";
import type { AuthContext } from "../_shared/auth.ts";
import { getAdminClient, getUserClient } from "../_shared/db.ts";
import { errorResponse } from "../_shared/errors.ts";
import { parseCopilotChatRequest, readBoundedJsonBody } from "./contract.ts";
import { createOpenAICopilotProvider } from "./openai.ts";
import { CopilotReadService } from "./read-service.ts";
import { CopilotService } from "./service.ts";
import type { CopilotChatResponse } from "./contract.ts";

export interface ArCopilotHandlerDependencies {
  authenticate(req: Request, companyId: string): Promise<AuthContext>;
  chat(
    req: Request,
    auth: AuthContext,
    request: ReturnType<typeof parseCopilotChatRequest>,
  ): Promise<CopilotChatResponse>;
}

function productionChat(
  req: Request,
  auth: AuthContext,
  request: ReturnType<typeof parseCopilotChatRequest>,
): Promise<CopilotChatResponse> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    throw new Error("Authenticated request lost authorization context.");
  }
  const reads = new CopilotReadService(
    getAdminClient(),
    getUserClient(authorization),
  );
  const model = createOpenAICopilotProvider({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
    model: Deno.env.get("OPENAI_COPILOT_MODEL") ??
      Deno.env.get("OPENAI_DOCUMENT_MODEL"),
  });
  return new CopilotService({ model, reads }).chat(auth, request);
}

const productionDependencies: ArCopilotHandlerDependencies = {
  authenticate: getAuthContext,
  chat: productionChat,
};

function subPath(pathname: string): string {
  const index = pathname.indexOf("/ar-copilot");
  return index < 0
    ? pathname
    : pathname.slice(index + "/ar-copilot".length) || "/";
}

export async function handleArCopilotRequest(
  req: Request,
  dependencies: ArCopilotHandlerDependencies = productionDependencies,
): Promise<Response> {
  if (req.method === "OPTIONS") return handleCORS();
  try {
    const url = new URL(req.url);
    if (req.method !== "POST" || !/^\/chat\/?$/.test(subPath(url.pathname))) {
      return jsonResponse({
        success: false,
        error: {
          code: "ROUTE_NOT_FOUND",
          message: `No route matches ${req.method} ${url.pathname}`,
        },
      }, 404);
    }
    if (url.search) {
      return jsonResponse({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Copilot chat does not accept query parameters.",
        },
      }, 400);
    }
    const companyId = extractCompanyId(req);
    const auth = await dependencies.authenticate(req, companyId);
    const request = parseCopilotChatRequest(await readBoundedJsonBody(req));
    const data = await dependencies.chat(req, auth, request);
    return jsonResponse({ success: true, data });
  } catch (error) {
    const { status, body } = errorResponse(error);
    return jsonResponse(body, status);
  }
}

export function createArCopilotHandler(
  dependencies: ArCopilotHandlerDependencies = productionDependencies,
): (req: Request) => Promise<Response> {
  return (req) => handleArCopilotRequest(req, dependencies);
}

export const handler = createArCopilotHandler();
if (import.meta.main) Deno.serve(handler);
