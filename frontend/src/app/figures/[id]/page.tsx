import AppShell from "@/components/AppShell";
import FigureComposer from "@/components/figure/FigureComposer";

export default async function FigurePageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Render inside the standard app shell so the global nav + BeakerSearch persist
  // and the composer is a page in the site, not a separate full-bleed surface.
  return (
    <AppShell>
      <FigureComposer pageId={id} />
    </AppShell>
  );
}
