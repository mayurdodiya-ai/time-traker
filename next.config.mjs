/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next', // tests build into their own folder so a running app is never disturbed
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ['mongoose', 'bcryptjs', 'jsonwebtoken', 'exceljs'],
  // Lets teammates on the LAN open the dev server by IP (e.g. http://192.168.1.108:8000) — otherwise Next.js
  // blocks cross-origin requests to its dev bundle/HMR assets and the page loads blank.
  allowedDevOrigins: ['192.168.1.108', '172.23.32.1'],
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default nextConfig;
