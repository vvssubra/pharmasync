import { describe, it, expect } from "vitest";
import { getErrorMessage } from "./errors";

describe("getErrorMessage", () => {
  it("returns the message of a real Error", () => {
    expect(getErrorMessage(new Error("boom"), "fallback")).toBe("boom");
  });

  // Supabase returns PostgrestError — a plain object, not an Error instance.
  // This is what an RLS rejection or trigger exception actually looks like.
  it("returns the message of a PostgrestError-shaped object", () => {
    const postgrestError = {
      message: 'new row violates row-level security policy for table "antibiotic_forms"',
      details: null,
      hint: null,
      code: "42501",
    };
    expect(getErrorMessage(postgrestError, "fallback")).toBe(
      'new row violates row-level security policy for table "antibiotic_forms"'
    );
  });

  it("falls back when the value carries no usable message", () => {
    expect(getErrorMessage(null, "fallback")).toBe("fallback");
    expect(getErrorMessage({}, "fallback")).toBe("fallback");
    expect(getErrorMessage({ message: "" }, "fallback")).toBe("fallback");
    expect(getErrorMessage({ message: 42 }, "fallback")).toBe("fallback");
  });
});
