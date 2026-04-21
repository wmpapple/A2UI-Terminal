import { Routes, Route, Navigate } from 'react-router-dom';



// ... 其他引入
import SmartDoc from './page/SmartDoc';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/doc" replace />} />


      {/* 👈 增加这一行 */}
      <Route path="/doc" element={<SmartDoc />} />
    </Routes>
  );
}

export default App;