import { describe, expect, it } from "vitest";
import { localTodayISODate } from "./now";

describe("localTodayISODate", () => {
  it("uses local calendar getters instead of a UTC ISO slice", () => {
    const localCalendar = {
      getFullYear: () => 2026,
      getMonth: () => 6,
      getDate: () => 28,
      toISOString: () => "2026-07-27T16:30:00.000Z",
    } as unknown as Date;

    expect(localTodayISODate(localCalendar)).toBe("2026-07-28");
  });
});
