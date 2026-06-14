import FigureComposer from "@/components/figure/FigureComposer";

export default async function FigurePageRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="h-[calc(100dvh-3.5rem)]">
      <FigureComposer pageId={id} />
    </div>
  );
}
