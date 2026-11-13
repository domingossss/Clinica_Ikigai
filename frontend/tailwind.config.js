/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
    "./index.html"
  ],
  theme: {
    extend: {
      colors: {
        // Cores institucionais personalizadas da Clínica Ikigai (extraídas da logo)
        primary: '#262B6B',        // Azul Índigo Ikigai (cor de fundo e destaque nobre)
        'primary-dark': '#1E2255', // Azul profundo (hover e ações primárias)
        secondary: '#BFA15F',      // Dourado Nobre (borda dos anéis, badges, destaques)
        'secondary-light': '#EFE6D2', // Dourado suave/creme (fundos de badges sutis)
        dark: '#181924',           // Tom escuro suave para textos principais
        gray: '#6B7280',           // Cinza neutro para textos de apoio
        'light-gray': '#F5F6FA',   // Cinza leve para telas de fundo
        white: '#ffffff',          // Branco puro (pétalas, cards)
      },
      fontFamily: {
        // Sugestão de tipografia moderna e elegante
        sans: ['Inter', 'Outfit', 'ui-sans-serif', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        // Sombras premium para cartões tridimensionais limpos
        'premium': '0 8px 30px rgba(0, 0, 0, 0.04)',
        'premium-hover': '0 12px 40px rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
}
