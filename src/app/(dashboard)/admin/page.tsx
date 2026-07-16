import { redirect } from "next/navigation";

/** /admin → the Users section is the admin landing screen. */
export default function AdminIndexPage() {
  redirect("/admin/users");
}
