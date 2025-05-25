// postcss.config.mjs (Reverted for Tailwind CSS v3)
const config = {
  plugins: {
    '@tailwindcss/postcss': {}, // Use the new package for Tailwind CSS v4
    autoprefixer: {},
  },
};

export default config;
