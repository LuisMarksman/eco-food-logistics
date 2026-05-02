import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import '../index.css'; 
import { api } from '../api';
const Register = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  
  const initialRole = searchParams.get('type') || 'donor';

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: initialRole
  });

  const [error, setError] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); // Clear previous errors
    
    try {
      // THE CONNECTION TO YOUR BACKEND
      await api.post('/auth/register', formData);
      
      alert('Registration Successful! Redirecting to Login...');
      navigate('/login'); // Send them to login page
    } catch (err) {
      // Handle errors (like "Email already exists")
      setError(err.response?.data?.message || 'Registration failed');
    }
  };

  return (
    <div className="registration-container" style={{ maxWidth: '400px', margin: '50px auto', padding: '20px', border: '1px solid #ddd', borderRadius: '10px' }}>
      <h2 style={{ textAlign: 'center', color: '#199B74' }}>
        Register as {formData.role === 'donor' ? 'Donor' : 'Receiver'}
      </h2>
      
      {error && <p style={{ color: 'red', textAlign: 'center' }}>{error}</p>}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        
        <input 
          type="text" 
          name="username" 
          placeholder="Username" 
          onChange={handleChange} 
          required 
          style={{ padding: '10px', fontSize: '16px' }}
        />
        
        <input 
          type="email" 
          name="email" 
          placeholder="Email Address" 
          onChange={handleChange} 
          required 
          style={{ padding: '10px', fontSize: '16px' }}
        />
        
        <input 
          type="password" 
          name="password" 
          placeholder="Password" 
          onChange={handleChange} 
          required 
          style={{ padding: '10px', fontSize: '16px' }}
        />

        {}
        <select 
          name="role" 
          value={formData.role} 
          onChange={handleChange}
          style={{ padding: '10px', fontSize: '16px' }}
        >
          <option value="donor">Donor (Seller)</option>
          <option value="receiver">Receiver (Buyer)</option>
        </select>

        <button type="submit" style={{ padding: '12px', background: '#199B74', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontSize: '16px' }}>
          Sign Up
        </button>
      </form>
    </div>
  );
};

export default Register;
