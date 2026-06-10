/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@langchain/langgraph-checkpoint-postgres', 'pg'],
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/corpus.json', './data/embeddings.json'],
  },
};

export default nextConfig;
