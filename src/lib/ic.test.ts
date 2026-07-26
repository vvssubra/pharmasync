import { describe, it, expect } from "vitest";
import { formatIC, formatICInput, isValidIC } from "./ic";

describe("formatIC", () => {
  it("dash-formats a 12-digit IC", () => {
    expect(formatIC("880101015555")).toBe("880101-01-5555");
  });
  it("dash-formats a 12-digit IC that already has dashes", () => {
    expect(formatIC("880101-01-5555")).toBe("880101-01-5555");
  });
  it("falls back to the raw string for a non-12-digit IC", () => {
    expect(formatIC("77028341")).toBe("77028341");
  });
});

describe("formatICInput", () => {
  it("does not insert dashes before 6 digits", () => {
    expect(formatICInput("8801")).toBe("8801");
  });
  it("inserts the first dash after 6 digits", () => {
    expect(formatICInput("880101015555").length).toBeGreaterThan(0);
    expect(formatICInput("8801010")).toBe("880101-0");
  });
  it("inserts both dashes once 8+ digits are typed", () => {
    expect(formatICInput("88010101")).toBe("880101-01");
    expect(formatICInput("880101015555")).toBe("880101-01-5555");
  });
  it("truncates input beyond 12 digits", () => {
    expect(formatICInput("8801010155559999")).toBe("880101-01-5555");
  });
  it("strips non-digit characters before formatting", () => {
    expect(formatICInput("88-0101-01-5555")).toBe("880101-01-5555");
  });
});

describe("isValidIC", () => {
  it("is true for exactly 12 digits, dashes or not", () => {
    expect(isValidIC("880101015555")).toBe(true);
    expect(isValidIC("880101-01-5555")).toBe(true);
  });
  it("is false for 11 digits (missing leading zero)", () => {
    expect(isValidIC("10430011156")).toBe(false);
  });
  it("is false for 8 digits (malformed source data)", () => {
    expect(isValidIC("77028341")).toBe(false);
  });
});
