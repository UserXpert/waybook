/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the local dev server’s assets separate from a production build. Without
  // this, `next build` can replace `.next` while `next dev` is still serving it,
  // leaving open browser tabs with CSS URLs that no longer exist.
  distDir: process.env.WAYBOOK_NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@thebookingkit/core"],
};

export default nextConfig;
