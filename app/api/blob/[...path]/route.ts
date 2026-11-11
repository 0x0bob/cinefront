export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { blobGet, blobPut } from "@/lib/handlers";
type Ctx = { params: Promise<{ path: string[] }> };
export const GET = async (req: Request, ctx: Ctx) => blobGet(req, (await ctx.params).path);
export const PUT = async (req: Request, ctx: Ctx) => blobPut(req, (await ctx.params).path);
