import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "OpenShare",
  description: "Mint tokenized stock against your own pledged shares. Bonded brokers guarantee redemption.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Header />
          <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
          <footer className="mx-auto max-w-7xl px-4 pb-10 pt-4 text-xs text-dim">
            Rule enforced on-chain for every stock: tokens in existence ≤ shares still pledged + bond-funded reserve.
            Testnet prototype; not an offer of securities.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
