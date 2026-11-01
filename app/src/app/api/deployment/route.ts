import { deployment, json } from "@/lib/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return json(deployment());
  } catch (e) {
    return json({ error: `No deployment found: ${(e as Error).message}. Run pnpm deploy:local.` }, 404);
  }
}
