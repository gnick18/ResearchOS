"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { WIKI_NAV, type WikiNode } from "@/lib/wiki/nav";

/** Sticky left-rail navigation for the wiki. Highlights the current page
 *  and the section containing it. Collapses to a hamburger toggle on
 *  narrow screens. */
export default function WikiSidebar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile toggle */}
      <div className="lg:hidden sticky top-0 z-30 bg-white border-b border-gray-200 px-4 py-2 flex items-center">
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="inline-flex items-center gap-2 text-sm font-medium text-gray-700"
          aria-expanded={mobileOpen}
          aria-controls="wiki-sidebar-nav"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
          Wiki Contents
        </button>
      </div>

      <aside
        id="wiki-sidebar-nav"
        className={`
          ${mobileOpen ? "block" : "hidden"} lg:block
          lg:sticky lg:top-0 lg:h-screen lg:w-64 lg:flex-shrink-0
          bg-white border-r border-gray-200 overflow-y-auto
        `}
      >
        <div className="px-5 py-6">
          <Link
            href="/wiki"
            className="block text-base font-bold text-gray-900 tracking-tight hover:text-gray-700"
            onClick={() => setMobileOpen(false)}
          >
            ResearchOS Wiki
          </Link>
          <p className="mt-1 text-xs text-gray-500">Help & Documentation</p>
        </div>
        <nav className="px-3 pb-10 text-sm">
          {WIKI_NAV.map((node) => (
            <SidebarNode
              key={node.href}
              node={node}
              depth={0}
              currentPath={pathname}
              onNavigate={() => setMobileOpen(false)}
            />
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-gray-100">
          <Link
            href="/"
            className="text-xs text-gray-500 hover:text-gray-900 hover:underline"
          >
            ← Back to ResearchOS
          </Link>
        </div>
      </aside>
    </>
  );
}

function SidebarNode({
  node,
  depth,
  currentPath,
  onNavigate,
}: {
  node: WikiNode;
  depth: number;
  currentPath: string;
  onNavigate: () => void;
}) {
  const isActive = currentPath === node.href;
  const hasActiveDescendant =
    !!node.children && containsHref(node.children, currentPath);

  const indent = depth === 0 ? "" : "pl-3";

  return (
    <div className={depth === 0 ? "mb-1" : ""}>
      <Link
        href={node.href}
        onClick={onNavigate}
        className={`
          block px-3 py-1.5 rounded-md transition-colors ${indent}
          ${
            isActive
              ? "bg-blue-50 text-blue-700 font-semibold"
              : hasActiveDescendant && depth === 0
              ? "text-gray-900 font-semibold"
              : depth === 0
              ? "text-gray-900 font-semibold hover:bg-gray-50"
              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          }
        `}
      >
        {node.label}
      </Link>
      {node.children && (depth === 0 || hasActiveDescendant) ? (
        <div className="ml-2 mt-0.5 border-l border-gray-100">
          {node.children.map((child) => (
            <SidebarNode
              key={child.href}
              node={child}
              depth={depth + 1}
              currentPath={currentPath}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function containsHref(nodes: WikiNode[], href: string): boolean {
  for (const n of nodes) {
    if (n.href === href) return true;
    if (n.children && containsHref(n.children, href)) return true;
  }
  return false;
}
