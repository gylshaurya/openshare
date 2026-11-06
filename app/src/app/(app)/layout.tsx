import type { ReactNode } from "react";
import { AppFooter, AppHeader } from "@/components/Header";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-soft">
      <AppHeader />
      <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 py-8 sm:px-6">{children}</main>
      <AppFooter />
    </div>
  );
}
