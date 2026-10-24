import { describe, expect, it } from "vitest";
import { CoachRoundBody, CoachRoundResponse, PutProgressBody } from "../src/index.js";

describe("contract", () => {
  it("coach round body defaults", () => {
    expect(CoachRoundBody.parse({})).toEqual({ n: 8, focus: [] });
    expect(() => CoachRoundBody.parse({ n: 9 })).toThrow();
  });
  it("coach response is either questions or a fallback", () => {
    expect(CoachRoundResponse.parse({ fallback: true, reason: "no_key" }).fallback).toBe(true);
    expect(() => CoachRoundResponse.parse({ fallback: false, questions: [] })).toThrow();
  });
  it("put body keeps unknown state fields for the server to normalise", () => {
    expect(PutProgressBody.parse({ state: { xp: 1, extra: 2 } }).state).toMatchObject({ xp: 1 });
  });
});
