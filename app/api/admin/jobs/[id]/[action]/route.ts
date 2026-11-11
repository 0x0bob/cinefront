export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { adminAction } from "@/lib/handlers";
export const POST = async (req: Request, ctx: { params: Promise<{ id: string; action: string }> }) => {
  const p = await ctx.params;
  return adminAction(req, p.id, p.action);
};
