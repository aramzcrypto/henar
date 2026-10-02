/**
 * "Closed" is not one state.
 *
 * On a weekday night the underlying share still trades on overnight venues, so
 * a maker holding a tokenised position can offset it and quotes stay near
 * their weekday level. From 20:00 ET on Friday until 20:00 on Sunday nothing
 * trades or clears it, which is when quotes widen or vanish. Collapsing the
 * two into one "closed" flag hides exactly the window that carries the risk,
 * and 63% of Solana tokenised-equity volume trades while US exchanges are
 * shut.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { underlyingWindow } from "../src/lib/equities/market-hours";

/** An instant expressed in New York time, as a UTC date. September is EDT. */
const et = (day: number, hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 8, day, hour + 4, minute));

test("a weekday night is hedgeable; the weekend gap is not", () => {
  // Thursday 1 September 2026 is a Tuesday; use known weekdays below.
  // 2026-09-01 is a Tuesday, so the 4th is a Friday and the 5th a Saturday.
  const fridayAfternoon = et(4, 14);
  const fridayEvening = et(4, 18);
  const fridayNight = et(4, 21);
  const saturdayNoon = et(5, 12);
  const sundayAfternoon = et(6, 15);
  const sundayEvening = et(6, 21);
  const tuesdayNight = et(1, 23);
  const tuesdayPreMarket = et(1, 6);
  const tuesdayMidday = et(1, 12);

  assert.equal(underlyingWindow(fridayAfternoon, []).phase, "regular");
  assert.equal(underlyingWindow(fridayEvening, []).phase, "extended");

  // The boundary the report identifies: 20:00 ET on Friday.
  for (const instant of [fridayNight, saturdayNoon, sundayAfternoon]) {
    const window = underlyingWindow(instant, []);
    assert.equal(window.phase, "weekend", window.label);
    assert.equal(window.hedgeable, false);
  }

  // Sunday 20:00 ET reopens overnight trading, so it is hedgeable again.
  assert.equal(underlyingWindow(sundayEvening, []).phase, "overnight");
  assert.equal(underlyingWindow(sundayEvening, []).hedgeable, true);

  // A weeknight is not the weekend, however late it is.
  assert.equal(underlyingWindow(tuesdayNight, []).phase, "overnight");
  assert.equal(underlyingWindow(tuesdayNight, []).hedgeable, true);
  assert.equal(underlyingWindow(tuesdayPreMarket, []).phase, "extended");
  assert.equal(underlyingWindow(tuesdayMidday, []).phase, "regular");

  // Every phase says what it is, so a caller can tell a user.
  for (const instant of [tuesdayMidday, tuesdayNight, fridayNight]) assert.ok(underlyingWindow(instant, []).label.length > 0);
});

test("a holiday closes the regular session without creating a weekend gap", () => {
  // Labor Day 2026 falls on Monday 7 September.
  const holidays = [
    { market: "US_EQUITIES", date: "2026-09-07", timezone: "America/New_York", startTime: null, endTime: null },
  ];
  const holidayMidday = et(7, 12);
  const open = underlyingWindow(holidayMidday, []);
  const closed = underlyingWindow(holidayMidday, holidays);
  assert.equal(open.phase, "regular");
  // The shares do not trade on the holiday, but it is not the weekend gap:
  // the market reopens the next morning, so a maker is not stuck for two days.
  assert.equal(closed.phase, "extended");
  assert.equal(closed.hedgeable, true);
});

test("an unknown holiday calendar never reports a weekend gap that is not one", () => {
  // Holidays unavailable: regularSessionStatus returns "unknown", and a
  // weekday midday must not be mistaken for the weekend.
  const window = underlyingWindow(et(1, 12), null);
  assert.notEqual(window.phase, "weekend");
  assert.equal(window.hedgeable, true);
});
