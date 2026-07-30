import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Survey from "./Survey";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Survey calls watch() with no arguments (Survey.tsx), which subscribes to all
// 19 fields, so every one of the 13 Likert clicks below re-renders the entire
// form. In jsdom that costs ~5s for a full pass, which is why the two
// submit-path tests declare an explicit timeout instead of the 5000ms default.
const SLOW_FORM_TIMEOUT = 20_000;

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

  it("renders all 3 sections with 13 Likert questions total", () => {
    render(<Survey />);
    expect(screen.getByText("Section A: Application and Approval Process")).toBeInTheDocument();
    expect(screen.getByText("Section B: Tracking of Requests and Approvals")).toBeInTheDocument();
    expect(screen.getByText("Section C: Overall User Experience")).toBeInTheDocument();
    expect(screen.getAllByRole("radiogroup")).toHaveLength(13);
  });

  it("renders all 4 open-ended questions, none duplicating each other", () => {
    render(<Survey />);
    expect(
      screen.getByText(/most time-consuming/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/repetitive or unnecessary/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/delay, missing form or difficulty retrieving/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/single most important improvement/)
    ).toBeInTheDocument();
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
      ).toBe(13);
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
    for (let i = 0; i < 13; i++) fillLikert(i, 4);

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
      a1: "4",
      a6: "4",
      b1: "4",
      b4: "4",
      c1: "4",
      c3: "4",
    });
    expect(options.mode).toBe("no-cors");

    await waitFor(() => {
      expect(screen.getByText("Thank you")).toBeInTheDocument();
    });
  }, SLOW_FORM_TIMEOUT);

  it("allows submit with all Likert questions answered and open questions left blank (optional)", async () => {
    render(<Survey />);

    fireEvent.change(screen.getByLabelText("Your name *"), {
      target: { value: "Pn. Aisyah" },
    });
    fireEvent.change(screen.getByLabelText("Your email *"), {
      target: { value: "aisyah@moh.gov.my" },
    });
    fireEvent.change(screen.getByLabelText("Your role *"), {
      target: { value: "pharmacist" },
    });
    for (let i = 0; i < 13; i++) fillLikert(i, 3);

    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  }, SLOW_FORM_TIMEOUT);
});
