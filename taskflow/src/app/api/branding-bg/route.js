import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function GET() {
  try {
    const image = await readFile(join(process.cwd(), "public", "og-image.jpg"));
    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("Image not found", { status: 404 });
  }
}
