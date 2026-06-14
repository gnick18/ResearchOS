import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PdfFigurePicker } from "../PdfFigurePicker";

// pdf-render is browser-only (real canvas + pdfjs), so mock it and assert the
// picker's phase transitions + the onPick wiring around it.
vi.mock("@/lib/ai/pdf-render", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/pdf-render")>(
    "@/lib/ai/pdf-render",
  );
  return {
    ...actual,
    renderPdfThumbnails: vi.fn(async () => ({
      thumbs: [
        { pageNumber: 1, dataUrl: "data:image/jpeg;base64,p1", width: 240, height: 320 },
        { pageNumber: 2, dataUrl: "data:image/jpeg;base64,p2", width: 240, height: 320 },
      ],
      pageCount: 2,
      capped: false,
    })),
    renderPdfRegion: vi.fn(async () => "data:image/png;base64,cropped"),
  };
});

const source = new ArrayBuffer(8);

describe("PdfFigurePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page thumbnails after loading", async () => {
    render(
      <PdfFigurePicker source={source} pdfName="paper.pdf" onPick={vi.fn()} onClose={vi.fn()} />,
    );
    expect(await screen.findByTestId("beakerbot-pdf-thumb-1")).toBeTruthy();
    expect(screen.getByTestId("beakerbot-pdf-thumb-2")).toBeTruthy();
    expect(screen.getByText("Pick the figure to match")).toBeTruthy();
  });

  it("opens a page into the crop phase when a thumbnail is clicked", async () => {
    render(
      <PdfFigurePicker source={source} pdfName="paper.pdf" onPick={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(await screen.findByTestId("beakerbot-pdf-thumb-2"));
    // Crop footer actions appear once the page preview renders.
    expect(await screen.findByText("Use whole page")).toBeTruthy();
    expect(screen.getByTestId("beakerbot-pdf-use-region")).toBeTruthy();
  });

  it("stages the cropped figure via onPick and closes on 'Use whole page'", async () => {
    const onPick = vi.fn();
    const onClose = vi.fn();
    render(
      <PdfFigurePicker source={source} pdfName="paper.pdf" onPick={onPick} onClose={onClose} />,
    );
    fireEvent.click(await screen.findByTestId("beakerbot-pdf-thumb-1"));
    fireEvent.click(await screen.findByText("Use whole page"));
    await waitFor(() => expect(onPick).toHaveBeenCalledWith("data:image/png;base64,cropped"));
    expect(onClose).toHaveBeenCalled();
  });

  it("disables 'Use this figure' until a region is selected", async () => {
    render(
      <PdfFigurePicker source={source} pdfName="paper.pdf" onPick={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.click(await screen.findByTestId("beakerbot-pdf-thumb-1"));
    const useRegion = (await screen.findByTestId(
      "beakerbot-pdf-use-region",
    )) as HTMLButtonElement;
    expect(useRegion.disabled).toBe(true);
  });

  it("calls onClose when the backdrop is clicked", async () => {
    const onClose = vi.fn();
    const { getByTestId } = render(
      <PdfFigurePicker source={source} pdfName="paper.pdf" onPick={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(getByTestId("beakerbot-pdf-figure-picker"));
    expect(onClose).toHaveBeenCalled();
  });
});
