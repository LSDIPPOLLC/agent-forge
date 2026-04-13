const sidebarHTML = `
<div class="sidebar-header">
  <a href="/agent-forge/" class="logo">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Agent Forge</span>
  </a>
</div>
<nav class="sidebar-nav">
  <div class="nav-section">
    <span class="nav-section-title">Getting Started</span>
    <a href="/agent-forge/" class="nav-link">Overview</a>
    <a href="/agent-forge/install" class="nav-link">Installation</a>
    <a href="/agent-forge/quickstart" class="nav-link">Quick Start</a>
  </div>
  <div class="nav-section">
    <span class="nav-section-title">Core Concepts</span>
    <a href="/agent-forge/concepts/architecture" class="nav-link">Architecture</a>
    <a href="/agent-forge/concepts/agent-format" class="nav-link">Agent Format</a>
    <a href="/agent-forge/concepts/evaluation" class="nav-link">Evaluation Pipeline</a>
    <a href="/agent-forge/concepts/refinement" class="nav-link">Refinement Loop</a>
    <a href="/agent-forge/concepts/safeguards" class="nav-link">Overfitting Safeguards</a>
  </div>
  <div class="nav-section">
    <span class="nav-section-title">Components</span>
    <a href="/agent-forge/components/generator" class="nav-link">Generator</a>
    <a href="/agent-forge/components/evaluator" class="nav-link">Evaluator</a>
    <a href="/agent-forge/components/refiner" class="nav-link">Refiner</a>
    <a href="/agent-forge/components/test-generator" class="nav-link">TestGenerator</a>
    <a href="/agent-forge/components/registry" class="nav-link">Registry</a>
    <a href="/agent-forge/components/quality-gate" class="nav-link">QualityGate</a>
    <a href="/agent-forge/components/loop-controller" class="nav-link">LoopController</a>
    <a href="/agent-forge/components/runtime" class="nav-link">Runtime</a>
  </div>
  <div class="nav-section">
    <span class="nav-section-title">CLI</span>
    <a href="/agent-forge/cli" class="nav-link">CLI Reference</a>
  </div>
</nav>
`;

document.addEventListener('DOMContentLoaded', () => {
  const sidebarContainer = document.querySelector('.sidebar-container');
  if (sidebarContainer) {
    sidebarContainer.innerHTML = sidebarHTML;
  }

  const sidebar = document.querySelector('.sidebar');
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const overlay = document.querySelector('.overlay');

  if (mobileMenuBtn && sidebar) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  }

  const currentPath = window.location.pathname;
  document.querySelectorAll('.nav-link').forEach(link => {
    const href = link.getAttribute('href');
    if (href === currentPath || (href !== '/agent-forge/' && currentPath.startsWith(href))) {
      link.classList.add('active');
    }
  });
});