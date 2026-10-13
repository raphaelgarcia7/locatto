import { DashboardPage } from '../dashboard/DashboardPage';
import { ModuleCard } from '../components/ModuleCard';
import { modules } from '../modules';

export function HomePage() {
  return (
    <>
      <DashboardPage />
      <section aria-labelledby="modules-title">
        <h2 id="modules-title">Áreas da locadora</h2>
        <div className="module-grid">
          {modules.map((module) => (
            <ModuleCard key={module.path} module={module} />
          ))}
        </div>
      </section>
    </>
  );
}
