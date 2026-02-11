// Import the necessary modules
import withPWA from "next-pwa";
/** @type {NextConfig} */

const pwaConfig = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NEXT_PUBLIC_CONTEXT === "development",
  // skipWaiting: false,
  // cacheOnFrontEndNav: true,
});

const nextConfig = {
  ...pwaConfig,
  // reactStrictMode: false,
  // logging: {
  //   fetches: {
  //     fullUrl: true,
  //   },
  // },
};

export default nextConfig;
