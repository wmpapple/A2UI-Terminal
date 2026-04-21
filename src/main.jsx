import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom' // 👈 引入路由引擎

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter> {/* 👈 用路由引擎把 App 包起来 */}
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)