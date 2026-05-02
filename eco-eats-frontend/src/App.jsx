import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from './components/Navbar'; 
import Home from './pages/Home'; 
import Register from './pages/Register';
import Login from './pages/Login'; 
import RouteAnalyzer from './pages/RouteAnalyzer'; 
import ListItems from './pages/ListItems';
import About from './pages/About';
import Dashboard from './pages/Dashboard';
import OrderPage from './pages/OrderPage';
import FreshnessLab from './pages/FreshnessLab';

function App() {
  return (
    <Router>
      <Navbar />  
      
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/route-analyzer" element={<RouteAnalyzer />} />
        <Route path="/list-items" element={<ListItems />} />
        <Route path="/about" element={<About />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/order" element={<OrderPage />} />
        <Route path="/freshness-lab" element={<FreshnessLab />} />
      </Routes>
    </Router>
  );
}

export default App;
