import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  getResumeVariant,
  serializeResumeVariant,
  setVariantItemIncluded,
  setVariantPreferredFormat,
} from "@/lib/resumeVariants";
import { positiveInteger, readJsonObject } from "@/lib/autofill/http";
import { validateVariantPatch } from "@/lib/apiValidation";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const variantId = positiveInteger(id);
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
  const variantId = positiveInteger(id);
  const body = await readJsonObject(req);
  const patch = body ? validateVariantPatch(body) : null;
  if (variantId === null || !patch) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (patch.kind === "format") {
    const db = getDb();
    if (!setVariantPreferredFormat(db, variantId, patch.preferredFormat)) {
      return NextResponse.json(
        { error: "Only an active draft or approved variant can change format" },
        { status: 409 }
      );
    }
    return NextResponse.json({
      variant: serializeResumeVariant(getResumeVariant(db, variantId)),
    });
  }
  const db = getDb();
  if (!setVariantItemIncluded(db, variantId, patch.itemId, patch.included)) {
    return NextResponse.json(
      { error: "Only an item on a draft variant can be changed" },
      { status: 409 }
    );
  }
  return NextResponse.json({
    variant: serializeResumeVariant(getResumeVariant(db, variantId)),
  });
}
