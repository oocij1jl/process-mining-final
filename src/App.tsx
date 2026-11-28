import { AnalysisProvider } from './state/analysis';
import { StoreProvider } from './state/store';
import type { PageId } from './state/types';
import { CaseDrawer } from './components/cases';
import { ScopeBar, Sidebar, Toasts, useHashRoute } from './components/layout';
import { ErrorBoundary } from './components/ui';
import { OverviewPage } from './pages/OverviewPage';
import { AnalysisPage } from './pages/AnalysisPage';
import { DesignPage } from './pages/DesignPage';
import { ModelPage } from './pages/ModelPage';
import { ImplementationPage } from './pages/ImplementationPage';
import { MonitorPage } from './pages/MonitorPage';
import { RefinePage } from './pages/RefinePage';
import { ExportPage } from './pages/ExportPage';

const PAGE_COMPONENTS: Record<PageId, (props: { navigate: (p: PageId) => void }) => React.JSX.Element> = {
  overview: OverviewPage,
  analysis: AnalysisPage,
  design: DesignPage,
  model: ModelPage,
  implementation: ImplementationPage,
  monitor: MonitorPage,
  refine: RefinePage,
  export: ExportPage,
};

function Shell() {
  const [page, navigate] = useHashRoute();
  const Page = PAGE_COMPONENTS[page];
  return (
    <div className="flex h-full">
      <Sidebar page={page} navigate={navigate} />
      <div className="flex min-w-0 flex-1 flex-col overflow-auto">
        <ScopeBar />
        <main className="mx-auto w-full max-w-[1500px] flex-1 px-6 py-6">
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
