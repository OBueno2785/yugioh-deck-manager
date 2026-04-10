/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        bg:      "#0f0f13",
        surface: "#1a1a24",
        border:  "#2a2a3a",
        text:    "#e2e2f0",
        muted:   "#7070a0",
        accent:  "#c89b3c",
        danger:  "#e05050",
        success: "#50c878",
      },
    },
  },
  plugins: [],
};
