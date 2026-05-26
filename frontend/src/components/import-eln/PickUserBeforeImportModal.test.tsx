// Component-level RTL coverage for PickUserBeforeImportModal — the
// inline user-picker that opens when "Import from LabArchives" is
// clicked on ResearchFolderSetupNew without a signed-in user.
//
// The picker is intentionally dumb: it shows existing-user tiles, an
// inline create form, and a close button. All sign-in side effects
// (including the sticky-intent sessionStorage flag) are owned by the
// parent component's onPickUser / onCreateUser callbacks. Here we
// verify the picker's local mechanics — input validation, callback
// wiring, zero-state collapse — without re-testing the parent's flag
// management (covered in ResearchFolderSetupNew.test.tsx).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

// UserAvatar pulls in useQuery via useUserColor. Stub it out at the
// module level so the picker can render without a QueryClientProvider.
vi.mock("@/components/UserAvatar", () => ({
  default: ({ username }: { username: string }) => (
    <span data-testid={`user-avatar-${username}`}>{username[0]}</span>
  ),
}));

import PickUserBeforeImportModal from "./PickUserBeforeImportModal";

describe("PickUserBeforeImportModal", () => {
  it("renders nothing when isOpen=false", () => {
    const { container } = render(
      <PickUserBeforeImportModal
        isOpen={false}
        availableUsers={["mira"]}
        onPickUser={vi.fn()}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders existing-user tiles and the create form when users exist", () => {
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={["mira", "alex"]}
        onPickUser={vi.fn()}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByTestId("eln-pick-user-tile-mira")).toBeInTheDocument();
    expect(screen.getByTestId("eln-pick-user-tile-alex")).toBeInTheDocument();
    expect(screen.getByTestId("eln-pick-user-new-input")).toBeInTheDocument();
    expect(screen.getByTestId("eln-pick-user-create-btn")).toBeInTheDocument();
  });

  it("collapses the tile list when there are zero existing users", () => {
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={[]}
        onPickUser={vi.fn()}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("eln-pick-user-list")).toBeNull();
    expect(screen.getByTestId("eln-pick-user-new-input")).toBeInTheDocument();
    // The create-form heading flips for the empty case.
    expect(screen.getByText("Create your first account")).toBeInTheDocument();
  });

  it("fires onPickUser when a tile is clicked", () => {
    const onPickUser = vi.fn();
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={["mira"]}
        onPickUser={onPickUser}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("eln-pick-user-tile-mira"));
    expect(onPickUser).toHaveBeenCalledWith("mira");
  });

  it("fires onCreateUser with sanitized username when Create is clicked", () => {
    const onCreateUser = vi.fn().mockResolvedValue(true);
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={[]}
        onPickUser={vi.fn()}
        onCreateUser={onCreateUser}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByTestId(
      "eln-pick-user-new-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  alex  " } });
    fireEvent.click(screen.getByTestId("eln-pick-user-create-btn"));
    expect(onCreateUser).toHaveBeenCalledWith("alex");
  });

  it("rejects an empty username with an inline error and skips the callback", () => {
    const onCreateUser = vi.fn().mockResolvedValue(true);
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={[]}
        onPickUser={vi.fn()}
        onCreateUser={onCreateUser}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("eln-pick-user-create-btn"));
    expect(onCreateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "Please enter a username",
    );
  });

  it("rejects an invalid username with an inline error and skips the callback", () => {
    const onCreateUser = vi.fn().mockResolvedValue(true);
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={[]}
        onPickUser={vi.fn()}
        onCreateUser={onCreateUser}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByTestId(
      "eln-pick-user-new-input",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "alex@bad" } });
    fireEvent.click(screen.getByTestId("eln-pick-user-create-btn"));
    expect(onCreateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain(
      "letters, numbers, underscores",
    );
  });

  it("fires onClose when the corner close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={["mira"]}
        onPickUser={vi.fn()}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("eln-pick-user-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires onClose when the dark backdrop is clicked", () => {
    const onClose = vi.fn();
    render(
      <PickUserBeforeImportModal
        isOpen
        availableUsers={["mira"]}
        onPickUser={vi.fn()}
        onCreateUser={vi.fn().mockResolvedValue(true)}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByTestId("eln-pick-user-modal"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
