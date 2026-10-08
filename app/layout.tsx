import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TwinWatch · Human Digital Twin",
  description: "Video and live webcam posture monitoring with an updating worker twin and explained alerts.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
