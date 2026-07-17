import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Survey from "./Survey";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function fillLikert(index: number, point: number) {
  const groups = screen.getAllByRole("radiogroup");
  const group = groups[index];
  const radio = group.querySelectorAll('[role="radio"]')[point - 1] as HTMLElement;
  fireEvent.click(radio);
}

describe("Survey page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SHEETS_ENDPOINT", "https://script.google.com/macros/s/fake/exec");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({} as Response)));
  });

  it("renders the survey title and all 7 Likert questions", () => {
    render(<Survey />);
    expect(
      screen.getByText("Pre-Talk Survey — The Manual AMS Form")
    ).toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(7);
  });

  it("blocks submit and shows errors when name, email, role, and Likert answers are missing", async () => {
    render(<Survey />);
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("Please enter your name.")).toBeInTheDocument();
      expect(screen.getByText("Please enter your email.")).toBeInTheDocument();
      expect(screen.getByText("Please select your role.")).toBeInTheDocument();
      expect(
        screen.getAllByText("Please select an answer from 1 to 5.").length
      ).toBe(7);
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("shows a validation error for an invalid email", async () => {
    render(<Survey />);
    fireEvent.change(screen.getByLabelText("Your email *"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    });
  });

  it("submits a valid response to VITE_SHEETS_ENDPOINT and shows the thank-you state", async () => {
    render(<Survey />);

    fireEvent.change(screen.getByLabelText("Your name *"), {
      target: { value: "Dr. Ahmad" },
    });
    fireEvent.change(screen.getByLabelText("Your email *"), {
      target: { value: "ahmad@moh.gov.my" },
    });
    fireEvent.change(screen.getByLabelText("Your role *"), {
      target: { value: "mo" },
    });
    for (let i = 0; i < 7; i++) fillLikert(i, 4);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    const [, options] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const payload = JSON.parse(options.body as string);
    expect(payload).toMatchObject({
      name: "Dr. Ahmad",
      email: "ahmad@moh.gov.my",
      role: "mo",
      q1: "4",
      q7: "4",
    });
    expect(options.mode).toBe("no-cors");

    await waitFor(() => {
      expect(screen.getByText("Thank you")).toBeInTheDocument();
    });
  });
});
