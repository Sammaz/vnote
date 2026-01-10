/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'selector',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        vnote: {
          bg: '#0d0d0d',
          card: '#161616',
          border: '#262626',
          hover: '#1f1f1f',
        }
      },
    },
  },
  plugins: [],
}
