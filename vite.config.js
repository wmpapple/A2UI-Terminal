import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 🚀 大厂绝招：强制去重配置
  resolve: {
    dedupe: ['react', 'react-dom'] // 强制要求所有第三方包共用最外层的 react
  }
})