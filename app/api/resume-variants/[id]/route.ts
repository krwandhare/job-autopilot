import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getResumeVariant,
  serializeResumeVariant,
  setVariantItemIncluded,
  setVariantPreferredFormat,
} from "@/lib/resumeVariants";

function parseId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantId = parseId(id);
  if (variantId === null) {
    return NextResponse.json({ error: "Invalid variant id" }, { status: 400 });
  }
  const variant = getResumeVariant(getDb(), variantId);
  if (!variant) {
    return NextResponse.json({ error: "Variant not found" }, { status: 404 });
  }
  return NextResponse.json({ variant: serializeResumeVariant(variant) });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantId = parseId(id);
  const body: unknown = await req.json().catch(() => null);
  if (variantId === null || !body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const candidate = body as Record<string, unknown>;
  if (candidate.preferredFormat === "docx" || candidate.preferredFormat === "pdf") {
    const db = getDb();
    if (!setVariantPreferredFormat(db, variantId, candidate.preferredFormat)) {
      return NextResponse.json(
        { error: "Only an active draft or approved variant can change format" },
        { status: 409 }
      );
    }
    return NextResponse.json({
      variant: serializeResumeVariant(getResumeVariant(db, variantId)),
    });
  }
  const itemId = parseId(candidate.itemId);
  if (itemId === null || typeof candidate.included !== "boolean") {
    return NextResponse.json(
      { error: "Valid itemId and included are required" },
      { status: 400 }
    );
  }
  const db = getDb();
  if (!setVariantItemIncluded(db, variantId, itemId, candidate.included)) {
    return NextResponse.json(
      { error: "Only an item on a draft variant can be changed" },
      { status: 409 }
    );
  }
  return NextResponse.json({
    variant: serializeResumeVariant(getResumeVariant(db, variantId)),
  });
}
