// Unit: date-time formatter shows the full calendar date (year/month/day) + time, not time-of-day only.
// fmtTime (store.tsx) is intentionally time-only and used for message/reminder timestamps; member
// join time and agent creation date need the calendar date too — hence a separate fmtDateTime.
// Run: npx tsx --test --test-force-exit test/format.unit.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { fmtDateTime, fmtMessageTime, fmtMessageTimestamp } from "../web/src/format.ts";

test("fmtDateTime renders year-month-day and time, not a bare time-of-day", () => {
  const out = fmtDateTime("2026-06-25T14:30:00Z");
  assert.match(out, /2026/, `expected calendar year in: ${out}`);
  assert.match(out, /\d{1,2}:\d{2}/, `expected HH:MM in: ${out}`);
  assert.ok(out.length > "14:30:00".length, `expected date+time, got: ${out}`);
});

test("fmtDateTime is empty for missing/invalid input", () => {
  assert.equal(fmtDateTime(undefined), "");
  assert.equal(fmtDateTime(""), "");
});

test("fmtMessageTimestamp uses time only for today and keeps the date for older messages", () => {
  const now = new Date(2026, 6, 15, 12, 0);
  const today = new Date(2026, 6, 15, 9, 5).toISOString();
  const older = new Date(2026, 6, 14, 19, 50).toISOString();

  assert.match(fmtMessageTimestamp(today, now), /^\d{2}:\d{2}$/);
  assert.match(fmtMessageTimestamp(older, now), /2026/);
});

test("fmtMessageTimestamp is empty for missing or invalid input", () => {
  assert.equal(fmtMessageTimestamp(undefined), "");
  assert.equal(fmtMessageTimestamp("not-a-date"), "");
});

test("fmtMessageTime keeps continuation rows compact on historical dates", () => {
  assert.match(fmtMessageTime("2026-06-25T14:30:00Z"), /^\d{2}:\d{2}$/);
  assert.equal(fmtMessageTime("not-a-date"), "");
});
