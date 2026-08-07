import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ComingSoon from './ComingSoon';
import SlashExperiment from './pages/SlashExperiment';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/it" element={<Home />} />
        <Route path="/en" element={<Home />} />
        <Route path="/coming-soon" element={<ComingSoon />} />
        <Route path="/slash-experiment" element={<SlashExperiment />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
