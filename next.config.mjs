const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = "anatomia";
const basePath = isGithubActions ? `/${repositoryName}` : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath: basePath || undefined,
  assetPrefix: isGithubActions ? `/${repositoryName}/` : undefined,
  // Exposed so metadata (manifest, icons) and the service worker registration respect the Pages subpath.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
