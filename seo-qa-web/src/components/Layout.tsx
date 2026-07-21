import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Upload,
  History, Settings, GitCompare, Menu, X
} from 'lucide-react';

const navItems = [
  { to: '/',        label: 'Dashboard',  icon: LayoutDashboard, exact: true },
  { to: '/upload',  label: 'New Audit',  icon: Upload },
  { to: '/history', label: 'History',    icon: History },
  { to: '/compare', label: 'Compare',    icon: GitCompare },
  { to: '/settings',label: 'Settings',   icon: Settings },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const close = () => setOpen(false);

  return (
    <div className="layout">
      {/* Mobile header */}
      <div className="mobile-header">
        <button className="hamburger" onClick={() => setOpen(o => !o)} aria-label="Toggle menu">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
        <span style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>🔍 SEO QA</span>
      </div>

      {/* Sidebar overlay */}
      <div className={`sidebar-overlay ${open ? 'show' : ''}`} onClick={close} />

      {/* Sidebar */}
      <nav className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <span className="logo-icon">🔍</span>
          <span>SEO QA Framework</span>
        </div>
        <ul className="nav-list">
          {navItems.map(({ to, label, icon: Icon, exact }) => (
            <li key={to} className={`nav-item ${(exact ? location.pathname === to : location.pathname.startsWith(to)) ? 'active' : ''}`}>
              <NavLink to={to} onClick={close}>
                <span className="nav-icon"><Icon size={16} /></span>
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div style={{ padding: '12px 20px', borderTop: '1px solid rgba(255,255,255,.1)' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>SEO QA v0.1.0</span>
        </div>
      </nav>

      {/* Page content */}
      <main className="main-content">
        <div className="page-content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
