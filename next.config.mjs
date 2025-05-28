/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'up.edu.ph',
      },
      {
        protocol: 'https',
        hostname: 'eee.upd.edu.ph', // Added specific subdomain
      },
      {
        protocol: 'https',
        hostname: 'drive.google.com', // For links to files on Google Drive itself
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com', // For direct image content from Google Drive/Photos etc.
      },
      // Add other specific, trusted hostnames here if needed
    ],
  },
};

export default nextConfig;
