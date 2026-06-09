import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { arch, homedir, platform } from "node:os"
import { join } from "node:path"

const POSTHOG_KEY = "phc_ooF2gwNHCmDfzxrfCu5KwM7AZkhmQKDALBafDpoa7fMQ"
const POSTHOG_HOST = "https://us.i.posthog.com"
const POSTHOG_TIMEOUT_MS = 10000
const ANALYTICS_DIR = join(homedir(), ".an")
const ANALYTICS_ID_PATH = join(ANALYTICS_DIR, "registry-analytics-id")
let cachedUnknownId: string | null = null

export type CliCommand =
  | "login"
  | "publish"
  | "add"
  | "search"
  | "invite"
  | "install-skill"

export type CliCommandStatus = "success" | "error"
export type CliAnalyticsMetadata = Record<
  string,
  string | number | boolean | null | undefined
>

interface CaptureBaseParams {
  apiKey: string | null
  command: CliCommand
  version: string
  metadata?: CliAnalyticsMetadata
}

interface CaptureCompletedParams extends CaptureBaseParams {
  status: CliCommandStatus
  durationMs: number
  errorMessage?: string
}

export async function captureCliCommandStarted(
  params: CaptureBaseParams,
): Promise<boolean> {
  return captureCliPostHogEvent({
    event: "cli_command_started",
    ...params,
  })
}

export async function captureCliCommandCompleted(
  params: CaptureCompletedParams,
): Promise<boolean> {
  const { status, durationMs, errorMessage, ...base } = params
  return captureCliPostHogEvent({
    event: "cli_command_completed",
    status,
    durationMs,
    errorMessage,
    ...base,
  })
}

async function captureCliPostHogEvent(params: {
  event: string
  apiKey: string | null
  command: CliCommand
  version: string
  status?: CliCommandStatus
  durationMs?: number
  errorMessage?: string
  metadata?: CliAnalyticsMetadata
}): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), POSTHOG_TIMEOUT_MS)
  const identityStatus = params.apiKey ? "logged" : "anonymous"
  const unknownId = getUnknownId()
  if (!unknownId) {
    clearTimeout(timeout)
    return false
  }

  try {
    const properties = compactProperties({
      source: "cli",
      product: "21st_registry",
      identity_status: identityStatus,
      api_key: params.apiKey,
      unknown_id: unknownId,
      command: params.command,
      cli_version: params.version,
      status: params.status,
      duration_ms: params.durationMs,
      error_message: params.errorMessage,
      node_version: process.version,
      os: platform(),
      arch: arch(),
      ...params.metadata,
    })

    const response = await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: POSTHOG_KEY,
        event: params.event,
        distinct_id: unknownId,
        properties,
      }),
      signal: controller.signal,
    })

    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

function getUnknownId(): string | null {
  if (cachedUnknownId) return cachedUnknownId

  try {
    const existingId = readFileSync(ANALYTICS_ID_PATH, "utf-8").trim()
    if (existingId) {
      cachedUnknownId = `21st_registry_cli:anonymous:${existingId}`
      return cachedUnknownId
    }
  } catch (error) {
    if (!isFileNotFoundError(error)) return null
  }

  const id = randomUUID()
  try {
    mkdirSync(ANALYTICS_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(ANALYTICS_ID_PATH, id, { mode: 0o600 })
  } catch {
    return null
  }
  cachedUnknownId = `21st_registry_cli:anonymous:${id}`
  return cachedUnknownId
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function compactProperties(
  properties: CliAnalyticsMetadata,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [
      string,
      string | number | boolean | null,
    ] => entry[1] !== undefined),
  )
}
