import type { SupabaseClient } from "supabase";
import { getAdminClient } from "../_shared/db.ts";
import {
  requireUiTheme,
  type UiPreferenceDto,
  type UiTheme,
} from "./contract.ts";

interface UiPreferenceRow {
  user_id: string;
  theme_preference: UiTheme;
}

export interface UiPreferenceServiceContract {
  get(userId: string): Promise<UiPreferenceDto>;
  update(userId: string, theme: UiTheme): Promise<UiPreferenceDto>;
}

export class UiPreferenceService implements UiPreferenceServiceContract {
  constructor(private readonly client: SupabaseClient = getAdminClient()) {}

  async get(userId: string): Promise<UiPreferenceDto> {
    const { data, error } = await this.client
      .from("user_ui_preferences")
      .select("user_id,theme_preference")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to load UI preference: ${error.message}`);
    }
    if (!data) return { theme: "dark", source: "default" };
    const row = data as UiPreferenceRow;
    return { theme: requireUiTheme(row.theme_preference), source: "saved" };
  }

  async update(userId: string, theme: UiTheme): Promise<UiPreferenceDto> {
    const { data, error } = await this.client
      .from("user_ui_preferences")
      .upsert(
        { user_id: userId, theme_preference: theme },
        { onConflict: "user_id" },
      )
      .select("user_id,theme_preference")
      .single();
    if (error || !data) {
      throw new Error(
        `Failed to save UI preference: ${error?.message ?? "missing result"}`,
      );
    }
    const row = data as UiPreferenceRow;
    return { theme: requireUiTheme(row.theme_preference), source: "saved" };
  }
}
