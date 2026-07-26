import type { Config } from 'tailwindcss';

// 색상 토큰은 기존 vanilla 앱(index.html/landing.html)의 CSS 변수와 1:1 대응시켜
// 디자인이 그대로 유지되도록 했다.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-main': '#F9F9F8',
        panel: '#FFFFFF',
        panel2: '#F3F4F6',
        border: '#E5E7EB',
        'brand-primary': '#B88E68',
        'brand-hover': '#A07853',
        'brand-light': '#FDF8F4',
        'text-main': '#1F2937',
        'text-muted': '#6B7280',
        common: '#F59E0B',
      },
      borderRadius: {
        DEFAULT: '12px',
      },
    },
  },
  plugins: [],
};
export default config;
