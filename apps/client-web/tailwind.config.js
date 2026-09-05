/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './app.js', './styles.css'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        heading: ['Outfit', 'system-ui', 'sans-serif'],
        outfit: ['Outfit', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
};
