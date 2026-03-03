/**
 * Shared markdown rendering helpers for resolving relative image paths
 * through the backend's raw file serving endpoint.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

/**
 * Create a custom `img` component for ReactMarkdown that resolves
 * relative image paths (like `./Images/foo.png`) through the backend API.
 *
 * @param basePath - The directory in the data repo where the markdown file lives
 *                   (e.g. "methods/test-method" or "results/task-5")
 */
export function createImageComponent(basePath: string) {
  return function MarkdownImage({
    src,
    alt,
    ...props
  }: React.ImgHTMLAttributes<HTMLImageElement>) {
    let resolvedSrc = String(src || "");

    if (resolvedSrc.startsWith("./")) {
      const relativePath = resolvedSrc.slice(2);
      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(
        basePath + "/" + relativePath
      )}`;
    }

    return (
      <img
        src={resolvedSrc}
        alt={alt || ""}
        className="max-w-full rounded-lg"
        {...props}
      />
    );
  };
}
