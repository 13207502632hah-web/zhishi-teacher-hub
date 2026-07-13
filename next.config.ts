import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Word question-bank uploads are validated at 15MB by the route itself.
    // Keep the framework limit slightly higher so multipart overhead does not
    // reject a valid file before the route can return a useful JSON response.
    serverActions: { bodySizeLimit: "20mb" },
  },
};

export default nextConfig;
