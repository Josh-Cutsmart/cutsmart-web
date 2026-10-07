import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Contacts page used to be at /clients — old links, bookmarks and home-screen icons still land on it
  // (with their ?contact=<id> kept).
  async redirects() {
    return [
      { source: "/clients", destination: "/contacts", permanent: true },
      { source: "/clients/:path*", destination: "/contacts/:path*", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        // The phone/desktop notifications service worker (public/sw.js): never cached, so an update
        // always reaches devices.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
