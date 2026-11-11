import Nav from "@/components/Nav";
import RequestForm from "@/components/RequestForm";
import { cfg } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="wrap">
        <section className="hero">
          <h1>Describe a place. Step inside it.</h1>
          <p>Type a scene and get a 180° AI video dome you can look around in, on a screen or in a VR headset. Each scene is generated on request, so every request waits for a human OK.</p>
          <RequestForm pricePerMtoken={cfg().pricePerMtoken} />
        </section>
      </main>
    </>
  );
}
