import { notFound } from "next/navigation";

// Hard gate for the entire /dev/* tree. These are internal scratch/demo surfaces
// (pricing model, design probes, demo videos) that must NEVER be reachable in a
// deployed build. NODE_ENV is "production" for every Vercel deployment (preview
// AND production), so this 404s them everywhere except a local `next dev`, where
// NODE_ENV is "development". One file covers all /dev pages.
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <>{children}</>;
}
