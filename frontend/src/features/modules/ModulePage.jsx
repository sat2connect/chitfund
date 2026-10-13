import { PageHeader, Card } from '../../components/common/ui.jsx';
import { Banner } from '../../components/feedback/States.jsx';

// Honest landing page for modules not yet built: lists planned screens, offers no fake actions.
export default function ModulePage({ module }) {
  return (
    <>
      <PageHeader title={module.label} description={module.description} />
      <Banner tone="info">
        This module is not implemented yet. It is scheduled for Phase {module.phase}; no data is shown here.
      </Banner>
      <Card title="Planned screens" className="mt-4">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {module.screens.map((s) => (
            <li key={s} className="rounded border border-line px-3 py-2 text-sm text-muted">{s}</li>
          ))}
        </ul>
      </Card>
    </>
  );
}
