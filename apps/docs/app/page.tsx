import { redirect } from 'next/navigation';

// The docs site has no marketing landing of its own — the repository README is
// the front door. Send the root straight to the documentation.
export default function HomePage() {
  redirect('/docs');
}
