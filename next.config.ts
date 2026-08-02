import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist", "playwright"],
  allowedDevOrigins: ["192.168.0.214"],
};

export default nextConfig;
