import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Clock } from "lucide-react";
import { ExpandableStatCard } from "./expandable-stat-card";

describe("ExpandableStatCard", () => {
  it("renders the count and label", () => {
    render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Pending Approvals")).toBeInTheDocument();
  });

  it("keeps breakdown rows hidden until hovered", () => {
    render(
      <ExpandableStatCard
        icon={Clock}
        count={5}
        label="Pending Approvals"
        breakdown={[{ label: "Drug requests", value: 3 }, { label: "Antibiotic forms", value: 2 }]}
      />
    );
    expect(screen.queryByText("Drug requests")).not.toBeInTheDocument();
  });

  it("reveals breakdown rows on hover", () => {
    const { container } = render(
      <ExpandableStatCard
        icon={Clock}
        count={5}
        label="Pending Approvals"
        breakdown={[{ label: "Drug requests", value: 3 }, { label: "Antibiotic forms", value: 2 }]}
      />
    );
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.getByText("Drug requests")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("renders no breakdown section when none is given, even on hover", () => {
    const { container } = render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    fireEvent.mouseEnter(container.firstChild as Element);
    expect(screen.queryByText("Drug requests")).not.toBeInTheDocument();
  });

  it("fires onClick when clicked", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" onClick={onClick} />
    );
    fireEvent.click(container.firstChild as Element);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("fires onClick on Enter and Space when focused, without needing a click", () => {
    const onClick = vi.fn();
    const { container } = render(
      <ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" onClick={onClick} />
    );
    const card = container.firstChild as Element;
    fireEvent.keyDown(card, { key: "Enter" });
    fireEvent.keyDown(card, { key: " " });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("is not a button role when onClick is omitted", () => {
    const { container } = render(<ExpandableStatCard icon={Clock} count={5} label="Pending Approvals" />);
    expect((container.firstChild as Element).getAttribute("role")).toBeNull();
  });

  it("reveals breakdown rows on focus and hides them again on blur", async () => {
    const onClick = vi.fn();
    render(
      <ExpandableStatCard
        icon={Clock}
        count={5}
        label="Pending Approvals"
        onClick={onClick}
        breakdown={[{ label: "Drug requests", value: 3 }, { label: "Antibiotic forms", value: 2 }]}
      />
    );
    const card = screen.getByTestId("stat-card-Pending Approvals");

    fireEvent.focus(card);
    expect(screen.getByText("Drug requests")).toBeInTheDocument();

    fireEvent.blur(card);
    // The breakdown unmounts via an AnimatePresence exit transition, which is
    // asynchronous even in jsdom, so the removal must be awaited.
    await waitFor(() => expect(screen.queryByText("Drug requests")).not.toBeInTheDocument());
  });
});
