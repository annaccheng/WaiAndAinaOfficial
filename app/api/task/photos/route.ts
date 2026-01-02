import { NextResponse } from "next/server";

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN as string | undefined;

export async function POST(req: Request) {
  if (!BLOB_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN is not set" }, { status: 500 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported" }, { status: 400 });
  }
  if (file.size > 550 * 1024) {
    return NextResponse.json({ error: "Image exceeds 550kb after compression attempt" }, { status: 400 });
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const uploadRes = await fetch("https://api.vercel.com/v2/blobs", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${BLOB_TOKEN}`,
      "Content-Type": file.type || "application/octet-stream",
      "x-vercel-filename": safeName,
    },
    body: file,
  });

  const uploadJson = await uploadRes.json();
  if (!uploadRes.ok) {
    const friendly = uploadJson?.error?.message || "Failed to upload to Vercel Blob";
    return NextResponse.json({ error: friendly }, { status: uploadRes.status });
  }

  const blobUrl = uploadJson?.url;
  if (!blobUrl) {
    return NextResponse.json({ error: "Blob URL missing from upload response" }, { status: 500 });
  }

  return NextResponse.json({ url: blobUrl });
}
