export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { publicDetail } from "@/lib/handlers";
export const GET = async (req: Request, ctx: { params: Promise<{ id: string }> }) => publicDetail(req, (await ctx.params).id);
