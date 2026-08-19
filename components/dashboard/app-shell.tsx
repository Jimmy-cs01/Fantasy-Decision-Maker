import { Sidebar } from "./sidebar";

export function AppShell({ children, guest = false, guestView }: { children: React.ReactNode; guest?: boolean; guestView?: string }) {
  return <div className="min-h-screen md:flex">
    <Sidebar guest={guest} guestView={guestView} />
    <main className="min-w-0 flex-1 p-4 sm:p-5 md:p-8">{children}</main>
  </div>;
}
