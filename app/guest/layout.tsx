import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Guest League Workspace");

export default function GuestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
