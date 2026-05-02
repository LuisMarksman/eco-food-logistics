import '../index.css';

const About = () => {
  return (
    <main className="ops-page about-ops">
      <section className="ops-hero compact-hero">
        <div>
          <p className="eyebrow">Mission</p>
          <h1>Zero hunger needs fast, practical redistribution.</h1>
          <p>
            Eco Eats helps donors and receivers act on surplus food while it is still safe,
            fresh, and close enough to deliver.
          </p>
        </div>
      </section>

      <section className="about-grid">
        <article className="ops-card">
          <h2>The problem</h2>
          <p>
            Perishable surplus loses value by the hour. A simple listing board is not enough
            when the best recipient depends on distance, demand, pickup feasibility, and expiry.
          </p>
        </article>
        <article className="ops-card">
          <h2>The solution</h2>
          <p>
            The platform brings search, route analysis, and allocation scoring into one workflow
            so food can move to demand centers before it becomes waste.
          </p>
        </article>
        <article className="ops-card">
          <h2>The next stage</h2>
          <p>
            Demand center profiles, multi-stop driver routing, safety checks, and predictive
            surplus planning can turn this MVP into a coordination system.
          </p>
        </article>
      </section>
    </main>
  );
};

export default About;
