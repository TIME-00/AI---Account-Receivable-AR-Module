import { ValidationError } from "../_shared/errors.ts";

export const UI_THEMES = ["dark", "light"] as const;
export type UiTheme = (typeof UI_THEMES)[number];

export interface UiPreferenceDto {
  theme: UiTheme;
  source: "default" | "saved";
}

export function requireUiTheme(value: unknown): UiTheme {
  if (!UI_THEMES.includes(value as UiTheme)) {
    throw new Error("Stored UI theme preference is invalid.");
  }
  return value as UiTheme;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseUiThemePatch(value: unknown): UiTheme {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "theme") {
    throw new ValidationError("Only theme may be updated.", { field: "theme" });
  }
  if (!UI_THEMES.includes(value.theme as UiTheme)) {
    throw new ValidationError("theme must be dark or light.", {
      field: "theme",
    });
  }
  return value.theme as UiTheme;
}

export async function readUiThemePatch(req: Request): Promise<UiTheme> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    throw new ValidationError("Request body must be valid JSON.");
  }
  return parseUiThemePatch(value);
}
