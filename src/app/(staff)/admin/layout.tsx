import { AdminNav } from "./admin-nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto grid w-full max-w-[90rem] grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_12rem] lg:gap-4">
      <div className="min-w-0">{children}</div>
      <AdminNav />
    </div>
  );
}
