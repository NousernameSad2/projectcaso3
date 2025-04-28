/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**', // Allow any HTTPS hostname
        // port: '', // Optional port
        // pathname: '/account123/**', // Optional path pattern
      },
      // Add other trusted hostnames here later if needed
      // e.g., for image hosting services like Cloudinary, S3, etc.
    ],
  },
};

export default nextConfig;
