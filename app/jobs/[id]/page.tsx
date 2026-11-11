import Nav from "@/components/Nav";
import JobStatus from "@/components/JobStatus";

export const dynamic = "force-dynamic";

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <>
      <Nav />
      <main className="wrap hero">
        <h1>Your request</h1>
        <p className="note">Keep this page open or bookmark it: it updates by itself.</p>
        <JobStatus id={id} />
      </main>
    </>
  );
}
