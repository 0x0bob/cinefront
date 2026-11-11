import Link from "next/link";

export default function Nav() {
  return (
    <nav className="nav wrap" aria-label="Main">
      <Link className="brand" href="/">SceneShift</Link>
      <Link href="/gallery">Gallery</Link>
      <Link href="/admin">Admin</Link>
    </nav>
  );
}
