import Nav from "@/components/Nav";
import AdminPanel from "@/components/AdminPanel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · SceneShift", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <>
      <Nav />
      <main className="wrap hero">
        <h1>Admin</h1>
        <AdminPanel />
      </main>
    </>
  );
}
