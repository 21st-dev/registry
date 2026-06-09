export class CliExitError extends Error {
  constructor(
    readonly exitCode: string | number | null | undefined,
    message = `process_exit_${exitCode ?? 0}`,
  ) {
    super(message)
    this.name = "CliExitError"
  }
}

export function exitWithError(message: string, exitCode = 1): never {
  throw new CliExitError(exitCode, message)
}
