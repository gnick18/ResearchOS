/**
 * Shared markdown rendering helpers for resolving relative image paths
 * through the backend's raw file serving endpoint.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

/**
 * Create a custom `img` component for ReactMarkdown that resolves
 * relative image paths (like `./Images/foo.png` or `../../Images/{folder}/foo.png`)
 * through the backend API.
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

    // Handle new path structure: ../../Images/{folder}/{filename}
    // These paths go up two levels from the markdown file location
    if (resolvedSrc.startsWith("../../Images/")) {
      const imagePath = resolvedSrc.slice(3); // Remove "../../" to get "Images/{folder}/{filename}"
      
      // Go up two levels from basePath to get the repo root for this user's data
      // basePath format: "users/{username}/results/task-{id}" or "users/{username}/methods/test-method"
      // We want to go up to: "users/{username}"
      let basePathRoot = "";
      if (basePath) {
        const pathParts = basePath.split("/");
        // Go up two levels: remove the last two path components
        if (pathParts.length >= 2) {
          pathParts.splice(-2, 2);
          basePathRoot = pathParts.join("/");
        } else {
          // If we can't go up two levels, use empty string (shouldn't happen in practice)
          basePathRoot = "";
        }
      }
      
      // Construct the full path: basePathRoot + "/" + imagePath
      // Handle empty basePathRoot to avoid leading slash
      const fullPath = basePathRoot ? `${basePathRoot}/${imagePath}` : imagePath;
      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(fullPath)}`;
    }
    // Handle old path structure: ./Images/{filename}
    else if (resolvedSrc.startsWith("./")) {
      const relativePath = resolvedSrc.slice(2);
      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(
        basePath + "/" + relativePath
      )}`;
    }
    // Handle paths starting with Images/ (without ./ prefix)
    else if (resolvedSrc.startsWith("Images/")) {
      resolvedSrc = `${API_BASE}/github/raw?path=${encodeURIComponent(resolvedSrc)}`;
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
