import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EdgeWord",
  description: "A conversation, set in colour.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-variant="classic" data-density="comfortable" data-scale="default" data-motion="standard" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@300;400;500;700;900&family=Roboto+Mono:wght@400;500;600&display=swap" rel="stylesheet" />
        {/* FOWT prevention — apply all preferences before first paint */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function(){
            var h=document.documentElement;
            var t=localStorage.getItem("edgeword.theme")||"light";
            if(t==="system"){t=matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light";}
            h.setAttribute("data-theme",t);
            h.setAttribute("data-variant",localStorage.getItem("edgeword.variant")||"classic");
            h.setAttribute("data-density",localStorage.getItem("edgeword.density")||"comfortable");
            h.setAttribute("data-scale",localStorage.getItem("edgeword.scale")||"default");
            h.setAttribute("data-motion",localStorage.getItem("edgeword.motion")||"standard");
          })();
        `}} />
      </head>
      <body>{children}</body>
    </html>
  );
}
