import './style.css';

const app = document.querySelector('#app');

app.innerHTML = `
  <main class="page-shell">
    <header class="topbar">
      <a class="brand" href="/" aria-label="mentoro home">
        <span class="brand-mark" aria-hidden="true"><span></span><span></span></span>
        <span class="brand-word">mentoro<span>o</span></span>
      </a>
      <span class="environment-pill">MVP foundation</span>
    </header>

    <section class="hero" aria-labelledby="hero-title">
      <p class="eyebrow">MEDICAL TRAINING, WITH DIRECTION</p>
      <h1 id="hero-title">Your training journey,<br /><span>better connected.</span></h1>
      <p class="hero-copy">
        A structured home for clinical exposure, mentorship, and specialty logbooks.
        The platform foundation is being prepared.
      </p>
      <div class="status-card" role="status">
        <span class="status-dot" aria-hidden="true"></span>
        <div>
          <strong>Application shell is running</strong>
          <p>Authentication, database schema, and protected workflows are not enabled yet.</p>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>mentoro</span>
      <span>Built for safer, more structured medical training.</span>
    </footer>
  </main>
`;
