import { Link, useNavigate, useLocation } from 'react-router-dom';
import '../index.css';
import { getStoredUser } from '../utils/foodDisplay';

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const user = getStoredUser();
  const isActive = (path) => location.pathname === path;

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <header className="app-navbar">
      <div className="logo-container">
        <Link to="/" className="brand-link">
          <img
            src="https://i.postimg.cc/mg6ThdXb/image-Photoroom.png"
            alt="Eco Eats Logo"
            className="logo"
          />
          <span>Eco Eats</span>
        </Link>
      </div>

      <nav className="nav-links">
        <Link to="/" className={`nav-item ${isActive('/') ? 'active' : ''}`}>Home</Link>
        <Link to="/list-items" className={`nav-item ${isActive('/list-items') ? 'active' : ''}`}>Search Food</Link>
        <Link to="/route-analyzer" className={`nav-item ${isActive('/route-analyzer') ? 'active' : ''}`}>Route Analyser</Link>
        <Link to="/freshness-lab" className={`nav-item ${isActive('/freshness-lab') ? 'active' : ''}`}>Freshness Lab</Link>
        <Link to="/about" className={`nav-item ${isActive('/about') ? 'active' : ''}`}>About</Link>

        {user ? (
          <>
            <Link to="/dashboard" className={`nav-item nav-dashboard ${isActive('/dashboard') ? 'active' : ''}`}>
              Dashboard
            </Link>
            <button onClick={handleLogout} className="nav-item nav-button">
              Logout
            </button>
            <span className="nav-user-chip">
              {user.username} - {user.role}
            </span>
          </>
        ) : (
          <>
            <Link to="/login" className="nav-item login-btn">Login</Link>
            <Link to="/register" className="nav-item register-btn">Register</Link>
          </>
        )}
      </nav>
    </header>
  );
};

export default Navbar;
