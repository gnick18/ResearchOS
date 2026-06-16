// POST /api/library/submit - accept community asset contributions.
//
// The single WRITE path into the open asset library. Enforces the same
// guarantees the curated ingest does, server-side, so nothing bad reaches the
// CDN: only open licenses (CC0 / CC-BY / CC-BY-SA), every SVG sanitized, a size +
// count cap. Accepted assets AUTO-PUBLISH into community-manifest.json flagged
// "unverified" - they show immediately but carry the "unverified for accuracy"
// badge until an INDEPENDENT user vouches (see /api/library/verify). The curated
// manifest.json is never touched here.
//
// nodejs runtime: the R2 (S3) client + crypto.randomUUID need Node, not edge.

import { NextResponse } from "next/server";

import type { LibraryAsset } from "@/lib/figure/asset-library";
import {
  classifyLicense,
  sanitizeSvg,
  looksLikeSvg,
  tokenize,
  formatCommunityCredit,
} from "@/lib/library/asset-validate";
import {
  putCommunitySvg,
  readCommunityManifest,
  writeCommunityManifest,
} from "@/lib/library/asset-storage";

export const runtime = "nodejs";

/** Feature gate. The route is inert (404) unless explicitly enabled. */
const CONTRIBUTE_ENABLED =
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "1" ||
  process.env.NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED === "true";

const MAX_ITEMS = 50;
const MAX_SVG_BYTES = 256 * 1024; // 256 KB per icon, generous for a vector

interface SubmitItem {
  svg: string;
  title: string;
  license: string;
  creator?: string | null;
  sourceUrl?: string | null;
  category?: string | null;
  tags?: string[];
  rightsAffirmed: boolean;
}

function bad(message: string, index?: number) {
  return NextResponse.json(
    { ok: false, error: message, ...(index !== undefined ? { index } : {}) },
    { status: 400 },
  );
}

export async function POST(req: Request) {
  if (!CONTRIBUTE_ENABLED) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  let body: { items?: SubmitItem[]; submittedBy?: string | null };
  try {
    body = await req.json();
  } catch {
    return bad("invalid JSON body");
  }

  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) return bad("no items");
  if (items.length > MAX_ITEMS) return bad(`too many items (max ${MAX_ITEMS})`);

  // The contributor @handle. Accountability + the independent-verifier rule rely
  // on it; null is allowed (anonymous) but then no one can ever be the
  // "submitter" to exclude, which is acceptable for an anonymous drop.
  const submittedBy = typeof body.submittedBy === "string" ? body.submittedBy : null;

  // Validate every item BEFORE writing anything, so a bad item fails the whole
  // batch atomically rather than half-publishing.
  const prepared: { asset: LibraryAsset; svg: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== "object") return bad("malformed item", i);
    if (it.rightsAffirmed !== true) return bad("rights affirmation required", i);
    const title = (it.title || "").trim();
    if (!title) return bad("title required", i);
    if (typeof it.svg !== "string" || !looksLikeSvg(it.svg)) return bad("not a valid SVG", i);
    if (Buffer.byteLength(it.svg, "utf8") > MAX_SVG_BYTES) return bad("SVG too large", i);

    const lic = classifyLicense(it.license);
    if (!lic.allowed) return bad(`license not allowed: ${it.license}`, i);

    const { svg, fills, hasViewBox } = sanitizeSvg(it.svg);
    const id = crypto.randomUUID();
    const creator = (it.creator || "").trim() || null;
    const category = (it.category || "").trim() || null;
    const tags = [
      ...new Set([
        ...tokenize(title),
        ...(Array.isArray(it.tags) ? it.tags.flatMap((t) => tokenize(String(t))) : []),
        ...(category ? tokenize(category) : []),
      ]),
    ];
    const credit = formatCommunityCredit({ title, creator, license: lic.id, sourceUrl: it.sourceUrl });
    prepared.push({
      svg,
      asset: {
        uid: `community:${id}`,
        source: "community",
        sourceId: id,
        title,
        creator,
        license: lic.id,
        licenseUrl: null,
        requiresAttribution: lic.attribution,
        sourceUrl: (it.sourceUrl || "").trim() || "",
        credit,
        svgPath: `assets/community/${id}.svg`,
        tags,
        category,
        fills,
        hasViewBox,
        submittedBy,
        verification: { status: "unverified", flags: 0 },
      },
    });
  }

  // Write the SVGs, then append to the community manifest (read-modify-write).
  try {
    for (const { asset, svg } of prepared) {
      await putCommunitySvg(asset.sourceId, svg);
    }
    const manifest = await readCommunityManifest();
    manifest.push(...prepared.map((p) => p.asset));
    await writeCommunityManifest(manifest);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `storage write failed: ${(err as Error).message}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    published: prepared.map((p) => p.asset),
    count: prepared.length,
  });
}
