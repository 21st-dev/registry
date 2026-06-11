import { getApiBaseUrl } from "./config.js"
import { printAndExit, requireApiKey } from "./utils.js"

// getApiBaseUrl() points at the REST base (…/api/v1); tRPC lives on the
// same origin at /api/trpc. Server uses tRPC v11 + superjson, so inputs
// and outputs are wrapped in a {"json": …} envelope (we ignore the
// optional "meta" part — Dates arrive as ISO strings, fine for display).
const TRPC_BASE = `${new URL(getApiBaseUrl()).origin}/api/trpc`

interface TrpcErrorShape {
  message?: string
  data?: { code?: string; httpStatus?: number }
}

function formatTrpcError(path: string, err: TrpcErrorShape | undefined): string {
  const code = err?.data?.code
  const message = err?.message || "Unknown error"
  switch (code) {
    case "UNAUTHORIZED":
      return "Not authenticated. Run `npx @21st-dev/registry login` first, or set API_KEY_21ST."
    case "FORBIDDEN":
      return `Access denied: ${message}`
    case "TOO_MANY_REQUESTS":
      return "Rate limit exceeded. Try again in a minute."
    case "NOT_FOUND":
    case "CONFLICT":
    case "BAD_REQUEST":
      return message
    default:
      return `${path} failed${code ? ` (${code})` : ""}: ${message}`
  }
}

async function trpcCall<T>(
  path: string,
  input: unknown,
  method: "GET" | "POST",
): Promise<T> {
  const apiKey = requireApiKey()
  let url = `${TRPC_BASE}/${path}`
  let body: string | undefined
  if (method === "GET") {
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
    }
  } else {
    body = JSON.stringify({ json: input ?? null })
  }

  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    })
  } catch (error) {
    printAndExit(
      `Network error calling ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const json = (await res.json().catch(() => null)) as {
    result?: { data?: { json?: T } }
    error?: { json?: TrpcErrorShape }
  } | null

  if (!json) {
    printAndExit(`${path} failed (HTTP ${res.status}): invalid response`)
  }
  if (json.error) {
    printAndExit(formatTrpcError(path, json.error.json))
  }
  return json.result?.data?.json as T
}

/** tRPC query → GET /api/trpc/{path}?input={"json":…} */
export function trpcQuery<T>(path: string, input?: unknown): Promise<T> {
  return trpcCall<T>(path, input, "GET")
}

/** tRPC mutation → POST /api/trpc/{path} with {"json":…} body */
export function trpcMutation<T>(path: string, input?: unknown): Promise<T> {
  return trpcCall<T>(path, input, "POST")
}
