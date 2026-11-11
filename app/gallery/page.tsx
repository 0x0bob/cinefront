import Nav from "@/components/Nav";
import SceneCard from "@/components/SceneCard";
import { allJobs, isPublished, publicScene } from "@/lib/jobs";
import { getKV } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Gallery · SceneShift" };

export default async function Gallery() {
  let scenes: ReturnType<typeof publicScene>[] = [];
  let offline = false;
  try {
    scenes = (await allJobs(getKV())).filter(isPublished).sort((a, b) => (b.published_utc ?? "").localeCompare(a.published_utc ?? "")).map(publicScene);
  } catch (e) {
    console.error("gallery: store unavailable:", e instanceof Error ? e.message : e);        // not connected yet / unreachable: show an empty gallery, not a crash
    offline = true;
  }
  return (
    <>
      <Nav />
      <main className="wrap">
        <section className="hero">
          <h1>Gallery</h1>
          <p>180° AI video domes made from a text prompt. Open one and look around.</p>
        </section>
        {scenes.length === 0 ? <p className="empty">{offline ? "The gallery is not available right now." : "No public scenes yet."}</p> : (
          <div className="grid" id="grid">
            {scenes.map((s) => <SceneCard key={s.id} s={{ id: s.id, title: s.title, label: s.label, created_utc: s.created_utc, duration_s: s.video.duration_s, poster: s.files.poster, preview: s.files.preview }} />)}
          </div>
        )}
        <p className="note">180° AI video dome (3DoF): a generated video on a dome, not a 3D reconstruction.</p>
      </main>
    </>
  );
}
