import { Link, useNavigate } from 'react-router-dom';
import '../index.css';
import { getStoredUser } from '../utils/foodDisplay';

const Home = () => {
  const navigate = useNavigate();
  const user = getStoredUser();

  return (
    <main className="ops-page home-ops">
      <section className="home-command">
        <div className="home-copy">
          <p className="eyebrow">Zero Hunger logistics</p>
          <h1>Move surplus food before freshness becomes waste.</h1>
          <p>
            Eco Eats matches perishable surplus to demand centers with expiry-aware search,
            route feasibility, and allocation scoring.
          </p>
          <div className="home-actions">
            <button className="btn-primary" onClick={() => navigate(user ? '/dashboard' : '/login')}>
              {user ? 'Open dashboard' : 'Login'}
            </button>
            <Link className="btn-secondary link-button" to="/list-items">Search food</Link>
          </div>
        </div>

        <div className="home-visual">
          <img src="https://i.postimg.cc/mg6ThdXb/image-Photoroom.png" alt="Eco Eats" />
          <div className="home-signal-grid">
            <span><strong>Route-first</strong><small>Claims check delivery time before allocation</small></span>
            <span><strong>Expiry-aware</strong><small>Urgency and risk labels guide action</small></span>
            <span><strong>Impact-ready</strong><small>Meals, kg saved, and status are tracked</small></span>
          </div>
        </div>
      </section>

      {!user && (
        <section className="role-cards">
          <article className="ops-card">
            <h2>For donors</h2>
            <p>List surplus with pickup address, category, expiry time, and quantity.</p>
            <Link className="btn-secondary link-button" to="/register?type=donor">Register as donor</Link>
          </article>
          <article className="ops-card">
            <h2>For receivers</h2>
            <p>Search by urgency, category, radius, and match score before claiming.</p>
            <Link className="btn-secondary link-button" to="/register?type=receiver">Register as receiver</Link>
          </article>
        </section>
      )}

      <section className="workflow-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Operating loop</p>
            <h2>List, match, route, deliver.</h2>
          </div>
        </div>
        <div className="workflow-grid">
          <article>
            <span>01</span>
            <h3>Capture surplus</h3>
            <p>Donors post food with expiry and pickup details.</p>
          </article>
          <article>
            <span>02</span>
            <h3>Rank matches</h3>
            <p>The backend prioritizes freshness, meals, distance, and availability.</p>
          </article>
          <article>
            <span>03</span>
            <h3>Analyze route</h3>
            <p>Receivers confirm route time and expiry risk before claiming.</p>
          </article>
          <article>
            <span>04</span>
            <h3>Track impact</h3>
            <p>Dashboards show rescued food, meals, urgency, and status.</p>
          </article>
        </div>
      </section>
    </main>
  );
};

export default Home;
