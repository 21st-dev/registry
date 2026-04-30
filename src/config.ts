import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const AN_DIR = join(homedir(), ".an")
const CREDENTIALS_PATH = join(AN_DIR, "credentials")

const API_KEY_ENV_NAMES = ["API_KEY_21ST", "AN_API_KEY"] as const
const API_BASE_URL_ENV_NAMES = ["API_URL_21ST", "AN_API_URL"] as const
const APP_BASE_URL_ENV_NAMES = ["APP_URL_21ST", "AN_URL"] as const

function getEnvValue(names: readonly string[]): string | null {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return null
}

export function getApiKey(): string | null {
  const fromEnv = getEnvValue(API_KEY_ENV_NAMES)
  if (fromEnv) return fromEnv
  try {
    const data = JSON.parse(readFileSync(CREDENTIALS_PATH, "utf-8"))
    return data.apiKey || null
  } catch {
    return null
  }
}

export function getApiBaseUrl(): string {
  return getEnvValue(API_BASE_URL_ENV_NAMES) ?? "https://21st.dev/api/v1"
}

export function getAppBaseUrl(): string {
  return getEnvValue(APP_BASE_URL_ENV_NAMES) ?? "https://21st.dev"
}

export function saveApiKey(apiKey: string): void {
  mkdirSync(AN_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(CREDENTIALS_PATH, JSON.stringify({ apiKey }, null, 2), {
    mode: 0o600,
  })
}
