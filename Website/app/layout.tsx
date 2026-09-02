import type { Metadata } from "next";
import { Manrope, IBM_Plex_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const manrope = Manrope({ variable: "--font-ui", subsets: ["latin"] });
const mono = IBM_Plex_Mono({ variable: "--font-mono", weight: ["400","500","600"], subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "PartsAtlas — Home Lab Inventory",
    description: "Identify, organize, and build with every part in your home lab.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "PartsAtlas", description: "Know every part. Build anything.", images: [{url:image,width:1200,height:630,alt:"PartsAtlas home lab inventory"}] },
    twitter: { card:"summary_large_image", title:"PartsAtlas", description:"Know every part. Build anything.", images:[image] },
  };
}

export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body className={`${manrope.variable} ${mono.variable}`}>{children}</body></html>;
}
