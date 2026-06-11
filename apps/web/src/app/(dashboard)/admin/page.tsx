import { redirect } from 'next/navigation';

/** /admin is a section index — the audit log is its front page. */
export default function AdminIndexPage() {
  redirect('/admin/audit');
}
