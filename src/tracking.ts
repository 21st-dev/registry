import {
  captureCliCommandCompleted,
  captureCliCommandStarted,
  type CliAnalyticsMetadata,
  type CliCommand,
} from "./analytics.js"
import { CliExitError } from "./exit.js"

interface RunTrackedCommandOptions {
  apiKey?: string | null
  captureCompleted?: typeof captureCliCommandCompleted
  captureStarted?: typeof captureCliCommandStarted
  getApiKey: () => string | null
  version: string
}

export async function runTrackedCommand(
  commandName: CliCommand,
  run: () => Promise<CliAnalyticsMetadata | void>,
  options: RunTrackedCommandOptions,
): Promise<void> {
  const startedAt = Date.now()
  const exit = process.exit.bind(process)
  const captureStarted = options.captureStarted ?? captureCliCommandStarted
  const captureCompleted = options.captureCompleted ?? captureCliCommandCompleted
  const getTrackingApiKey = () =>
    options.apiKey !== undefined ? options.apiKey : options.getApiKey()

  await captureStarted({
    apiKey: getTrackingApiKey(),
    command: commandName,
    version: options.version,
  })

  process.exit = ((code?: string | number | null | undefined): never => {
    throw new CliExitError(code)
  }) as typeof process.exit

  try {
    const metadata = await run()
    await captureCompleted({
      apiKey: getTrackingApiKey(),
      command: commandName,
      durationMs: Date.now() - startedAt,
      metadata: metadata ?? undefined,
      status: "success",
      version: options.version,
    })
  } catch (error) {
    const status = getExitStatus(error)
    await captureCompleted({
      apiKey: getTrackingApiKey(),
      command: commandName,
      durationMs: Date.now() - startedAt,
      errorMessage: getErrorMessage(error),
      status,
      version: options.version,
    })
    if (error instanceof CliExitError) {
      exit(error.exitCode)
    }
    throw error
  } finally {
    process.exit = exit as typeof process.exit
  }
}

function getExitStatus(error: unknown) {
  if (!(error instanceof CliExitError)) return "error"
  const code = error.exitCode ?? 0
  return code === 0 || code === "0" ? "success" : "error"
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
