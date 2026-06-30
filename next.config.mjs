const isGithubActions = process.env.GITHUB_ACTIONS === "true";
const repositoryName = "anatomia";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  basePath: isGithubActions ? `/${repositoryName}` : undefined,
  assetPrefix: isGithubActions ? `/${repositoryName}/` : undefined,
};

export default nextConfig;
