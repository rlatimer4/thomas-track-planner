import { useState } from 'react';
import { Builder } from './Builder';
import { InventoryView } from './InventoryView';
import { CatalogView } from './CatalogView';
import { AutoView } from './AutoView';
import { SettingsView } from './SettingsView';
import { useStore } from './store';

type Tab = 'build' | 'auto' | 'inventory' | 'catalog' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'build', label: 'Build', icon: '✎' },
  { id: 'auto', label: 'Auto design', icon: '✦' },
  { id: 'inventory', label: 'My track', icon: '▤' },
  { id: 'catalog', label: 'Catalog', icon: '◫' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('build');
  const { currentLayout } = useStore();
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◉
          </span>{' '}
          Track Planner
        </div>
        <nav className="tabs" aria-label="Sections">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id}>
              <span className="tab-icon" aria-hidden>
                {t.icon}
              </span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
      </header>
      <main className="main">
        {tab === 'build' && <Builder key={currentLayout.id} />}
        {tab === 'auto' && <AutoView onOpen={() => setTab('build')} />}
        {tab === 'inventory' && <InventoryView />}
        {tab === 'catalog' && <CatalogView />}
        {tab === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
