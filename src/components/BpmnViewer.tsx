import { useEffect, useRef, useState } from 'react';
import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import { Button, Notice } from './ui';

interface Canvas {
  zoom(level?: number | 'fit-viewport', center?: 'auto'): number;
}

/** Read-only BPMN 2.0 viewer (bpmn-js). Renders modeled XML; never generates BPMN. */
export function BpmnViewer({ xml, height = 460 }: { xml: string; height?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const viewer = useRef<NavigatedViewer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState(0);

  useEffect(() => {
    if (!container.current) return;
    const v = new NavigatedViewer({ container: container.current });
    viewer.current = v;
    return () => {
      v.destroy();
      viewer.current = null;
    };
  }, []);

  useEffect(() => {
    const v = viewer.current;
    if (!v) return;
    let cancelled = false;
    setError(null);
    v.importXML(xml)
      .then((res) => {
        if (cancelled) return;
        setWarnings(res.warnings.length);
        (v.get('canvas') as Canvas).zoom('fit-viewport', 'auto');
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [xml]);

  const zoom = (factor: number | 'fit') => {
    const canvas = viewer.current?.get('canvas') as Canvas | undefined;
    if (!canvas) return;
    if (factor === 'fit') canvas.zoom('fit-viewport', 'auto');
    else canvas.zoom(canvas.zoom() * factor);
  };

  return (
    <div>
      {error && (
        <div className="mb-2">
          <Notice tone="error" title="BPMN could not be rendered">{error}</Notice>
        </div>
      )}
      {warnings > 0 && !error && (
        <div className="mb-2">
          <Notice tone="warning">bpmn-js reported {warnings} import warning(s). The diagram may be incomplete.</Notice>
        </div>
      )}
      <div className="relative rounded-md border border-slate-200">
        <div ref={container} className="bpmn-canvas" style={{ height }} />
        <div className="absolute bottom-2 left-2 flex gap-1">
          <Button size="sm" onClick={() => zoom(1.2)} aria-label="Zoom in">+</Button>
          <Button size="sm" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</Button>
          <Button size="sm" onClick={() => zoom('fit')}>Fit</Button>
        </div>
      </div>
    </div>
  );
}
