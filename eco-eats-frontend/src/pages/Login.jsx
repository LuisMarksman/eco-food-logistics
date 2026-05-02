import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import '../index.css';
import { api } from '../api';

const Login = () => {
  const navigate = useNavigate();
  
  // State to hold form data
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    role: '' 
  });

  const [error, setError] = useState('');

  // Update state when user types
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Handle Form Submit
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      // 1. Send data to Backend
      const res = await api.post('/auth/login', formData);

      // 2. If successful, save the Token and User info
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data));

      // 3. Alert and Redirect based on Role
      alert('Login Successful!');

      if (formData.role === 'donor') {
        navigate('/dashboard'); 
      } else {
        navigate('/dashboard'); 
      }

    } catch (err) {
      // 4. Handle Errors
      console.error(err);
      setError(err.response?.data?.message || 'Login failed. Please try again.');
    }
  };

  return (
    <div className="login-page-body">
      <div className="login-container">
        {/* Logo */}
        <Link to="/">
          <img 
            src="https://i.postimg.cc/mg6ThdXb/image-Photoroom.png" 
            alt="Eco Eats Logo" 
            className="login-logo" 
          />
        </Link>

        <h2>Welcome Back</h2>

        {/* Error Message Display */}
        {error && <p style={{ color: 'red', marginBottom: '10px' }}>{error}</p>}

        <form className="login-form" onSubmit={handleSubmit}>
          
          <input 
            type="email" 
            name="email" 
            className="login-input" 
            placeholder="Email Address" 
            onChange={handleChange} 
            required 
          />

          <input 
            type="password" 
            name="password" 
            className="login-input" 
            placeholder="Password" 
            onChange={handleChange} 
            required 
          />

          <select 
            name="role" 
            className="login-input" 
            onChange={handleChange} 
            required 
            defaultValue=""
          >
            <option value="" disabled>Select Login Type</option>
            <option value="donor">Donor (Seller)</option>
            <option value="receiver">Receiver (Buyer)</option>
          </select>

          <button type="submit" className="login-submit-btn">Login</button>
        </form>

        <p style={{ marginTop: '20px', fontSize: '0.9rem', color: '#666' }}>
          Don't have an account? <Link to="/register" style={{ color: '#199B74' }}>Register here</Link>
        </p>
      </div>
    </div>
  );
};

export default Login;
