import { useState } from 'react';
import { AnalysisProvider } from './state/analysis';
import { StoreProvider } from './state/store';
import type { PageId } from './state/types';
import { CaseDrawer } from './components/cases';
import { ScopeBar, Sidebar, Toasts, useHashRoute } from './components/layout';
import { ErrorBoundary, cx } from './components/ui';
import { OverviewPage } from './pages/OverviewPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { DesignPage } from './pages/DesignPage';
import { ModelPage } from './pages/ModelPage';
import { ImplementationPage } from './pages/ImplementationPage';
import { MonitorPage } from './pages/MonitorPage';
import { RefinePage } from './pages/RefinePage';
import { FestivalPage } from './pages/FestivalPage';
import { ExportPage } from './pages/ExportPage';

const PAGE_COMPONENTS: Record<PageId, (props: { navigate: (p: PageId) => void }) => React.JSX.Element> = {
  overview: OverviewPage,
  analysis: AnalysisPage,
  design: DesignPage,
  model: ModelPage,
  implementation: ImplementationPage,
  monitor: MonitorPage,
  refine: RefinePage,
  festival: FestivalPage,
  export: ExportPage,
};

/** Graph-first workspaces use the full width of the window. */
const WIDE: ReadonlySet<PageId> = new Set(['analysis', 'model']);

function Shell() {
  const [page, navigate] = useHashRoute();
  const [menu, setMenu] = useState(false);
  const Page = PAGE_COMPONENTS[page];
  return (
    <div className="flex h-full">
      <Sidebar page={page} navigate={navigate} open={menu} onClose={() => setMenu(false)} />
      <div id="pp-main" className="pp-scroll flex min-w-0 flex-1 flex-col overflow-auto">
        <ScopeBar onMenu={() => setMenu(true)} navigate={navigate} />
        <main className={cx('w-full flex-1', WIDE.has(page) ? 'px-3 py-3 md:px-4' : 'mx-auto max-w-[1360px] px-4 py-6 md:px-8')}>
          <ErrorBoundary key={page} label={page}>
            <Page navigate={navigate} />
          </ErrorBoundary>
        </main>
      </div>
      <CaseDrawer />
      <Toasts />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <AnalysisProvider>
        <Shell />
      </AnalysisProvider>
    </StoreProvider>
  );
}
