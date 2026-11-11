export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { jobStatus } from "@/lib/handlers";
export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => jobStatus(req, (await ctx.params).id);
