/** @type {import('tailwindcss').Config} */
const typography = require('@tailwindcss/typography');

module.exports = {
  content: [
    './src/renderer/**/*.{html,ts,tsx,js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          50: '#FBF9F5',
          100: '#F6F2E9',
          200: '#EDE6D4',
          300: '#DFD3B8'
        },
        ink: {
          900: '#2B2A27',
          700: '#53514A',
          500: '#848076',
          300: '#B6B1A4'
        },
        sage: {
          50: '#F1F6F3',
          100: '#DCEAE2',
          500: '#7FA990',
          600: '#5E8B72',
          700: '#486F5A'
        },
        sky2: {
          100: '#DCE8F0',
          500: '#7FA4C2',
          600: '#5C85A5'
        },
        accent: {
          peach: '#F5C9A9',
          mint: '#B4DCBF',
          lavender: '#C9C0E3'
        }
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'Inter',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          '"JetBrains Mono"',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace'
        ]
      },
      boxShadow: {
        card: '0 2px 8px -2px rgba(43, 42, 39, 0.08), 0 1px 3px -1px rgba(43, 42, 39, 0.04)',
        cardHover: '0 10px 30px -8px rgba(43, 42, 39, 0.12), 0 4px 10px -4px rgba(43, 42, 39, 0.06)',
        sticky: '0 14px 40px -12px rgba(43, 42, 39, 0.25), 0 4px 14px -4px rgba(43, 42, 39, 0.12)',
        popup: '0 18px 50px -16px rgba(43, 42, 39, 0.28), 0 6px 18px -6px rgba(43, 42, 39, 0.12)'
      },
      borderRadius: {
        xl2: '14px',
        '3xl2': '22px'
      },
      keyframes: {
        popIn: {
          '0%': { transform: 'scale(0.94)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' }
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' }
        },
        toastIn: {
          '0%': { transform: 'translateY(16px)', opacity: '0' },
          '20%': { transform: 'translateY(0)', opacity: '1' },
          '80%': { transform: 'translateY(0)', opacity: '1' },
          '100%': { transform: 'translateY(-4px)', opacity: '0' }
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(127,169,144,0.45)' },
          '50%': { boxShadow: '0 0 0 8px rgba(127,169,144,0)' }
        }
      },
      animation: {
        popIn: 'popIn 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        fadeIn: 'fadeIn 160ms ease-out',
        slideUp: 'slideUp 200ms ease-out',
        toastIn: 'toastIn 1800ms ease-out forwards',
        pulseGlow: 'pulseGlow 2.2s ease-in-out infinite'
      }
    }
  },
  plugins: [typography]
};
