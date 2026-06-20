import type { ReactNode } from "react";

/**
 * Page-level content-width wrapper. `prose` is ~70ch for long-form reading pages,
 * `wide` for dashboards / card grids / lists, `full` for data tables / editors / canvases that should use all the width.
 */
type PageContainerWidth = "prose" | "wide" | "full";

const WIDTH_CLASS: Record<PageContainerWidth, string> = {
  prose: "max-w-3xl",
  wide: "max-w-screen-2xl",
  full: "max-w-none w-full",
};

export interface PageContainerProps {
  width: PageContainerWidth;
  className?: string;
  children?: ReactNode;
}

export function PageContainer({ width, className, children }: PageContainerProps) {
  const classes = ["mx-auto px-4 sm:px-6 lg:px-8", WIDTH_CLASS[width], className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}

export default PageContainer;
