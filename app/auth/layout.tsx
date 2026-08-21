import { privatePageMetadata } from "@/lib/seo/metadata";

export const metadata = privatePageMetadata("Account Security");

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
