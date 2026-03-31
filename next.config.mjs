const backendOrigin = process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8889';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async rewrites() {
    return [
      {
        source: '/自选股',
        destination: '/watchlist',
      },
      {
        source: '/%E8%87%AA%E9%80%89%E8%82%A1',
        destination: '/watchlist',
      },
      {
        source: '/api/:path*',
        destination: `${backendOrigin}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
