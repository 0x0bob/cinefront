import { notFound } from "next/navigation";
import DomeViewer from "@/components/DomeViewer";
import { getJob, isPublished, publicScene, titleOf } from "@/lib/jobs";
import { getKV } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const j = await getJob(getKV(), (await params).id);
  return isPublished(j) ? { title: `${titleOf(j)} · SceneShift` } : { title: "Not found" };
}

export default async function ScenePage({ params }: { params: Promise<{ id: string }> }) {
  const j = await getJob(getKV(), (await params).id);
  if (!isPublished(j)) notFound();                // private, unknown and malformed ids look the same
  return <DomeViewer scene={publicScene(j)} />;
}
