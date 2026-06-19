import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://backscroll.dev";
const TITLE = "Backscroll — a time machine for your terminal";
const DESCRIPTION =
  "Backscroll records every shell command and its output into a local, searchable SQLite/FTS5 store — so you can find that command from 3 weeks ago that actually worked by searching what it printed, not just what you typed. 100% local. No network, ever.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Backscroll",
  keywords: [
    "shell history",
    "terminal",
    "command history",
    "zsh",
    "bash",
    "SQLite",
    "FTS5",
    "full-text search",
    "CLI",
    "atuin alternative",
    "command output capture",
    "PTY",
    "local-first",
    "open source",
  ],
  authors: [{ name: "Backscroll" }],
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: "website",
    url: SITE_URL,
    siteName: "Backscroll",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description:
      "Records every command and its output, fully local. Search what your terminal printed — find the one that actually worked.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#161412",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}
      >
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
