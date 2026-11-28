import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Modeler from 'bpmn-js/lib/Modeler';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn-embedded.css';
import { Button, Notice } from './ui';

interface Canvas {
  zoom(level?: number | 'fit-viewport', center?: 'auto'): number;
}
interface CommandStack {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
}

export interface BpmnModelerHandle {
  saveXML(): Promise<string>;
}

/**
 * Native bpmn-js Modeler (palette, context pad, move/rename/connect, undo/redo).
 * Edits stay in this component until the page saves a new revision.
 */
export const BpmnModeler = forwardRef<BpmnModelerHandle, { xml: string; height?: number | string; onDirty?: (dirty: boolean) => void }>(
  function BpmnModeler({ xml, height = 520, onDirty }, ref) {
    const container = useRef<HTMLDivElement>(null);
    const modeler = useRef<Modeler | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [warnings, setWarnings] = useState(0);
    const [stack, setStack] = useState({ undo: false, redo: false });
    const dirtyCb = useRef(onDirty);
    dirtyCb.current = onDirty;

    useEffect(() => {
      if (!container.current) return;
      const m = new Modeler({ container: container.current });
      modeler.current = m;
      const cs = m.get('commandStack') as CommandStack;
      const onChange = () => {
        setStack({ undo: cs.canUndo(), redo: cs.canRedo() });
        dirtyCb.current?.(cs.canUndo());
      };
      m.on('commandStack.changed', onChange);
      return () => {
        m.destroy();
        modeler.current = null;
      };
    }, []);

    useEffect(() => {
      const m = modeler.current;
      if (!m) return;
      let cancelled = false;
      setError(null);
      m.importXML(xml)
        .then((res) => {
          if (cancelled) return;
          setWarnings(res.warnings.length);
          (m.get('canvas') as Canvas).zoom('fit-viewport', 'auto');
          setStack({ undo: false, redo: false });
          dirtyCb.current?.(false);
        })
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
      return () => {
        cancelled = true;
      };
    }, [xml]);

    useImperativeHandle(ref, () => ({
      async saveXML() {
        const m = modeler.current;
        if (!m) throw new Error('Modeler is not ready.');
        const { xml: out } = await m.saveXML({ format: true });
        if (!out) throw new Error('The modeler returned no XML.');
        return out;
      },
    }));

    const cmd = (fn: 'undo' | 'redo') => (modeler.current?.get('commandStack') as CommandStack | undefined)?.[fn]();
    const zoom = (factor: number | 'fit') => {
      const canvas = modeler.current?.get('canvas') as Canvas | undefined;
      if (!canvas) return;
      if (factor === 'fit') canvas.zoom('fit-viewport', 'auto');
      else canvas.zoom(canvas.zoom() * factor);
    };

    return (
      <div>
        {error && <Notice tone="error" title="This BPMN could not be opened in the editor" className="mb-2">{error}</Notice>}
        {warnings > 0 && !error && <Notice tone="warning" className="mb-2">The editor reported {warnings} import warning(s). Some elements may be missing.</Notice>}
        <div className="relative overflow-hidden rounded-lg border border-slate-200">
          <div ref={container} className="bpmn-canvas" style={{ height }} />
          <div className="absolute right-2 top-2 flex gap-1">
            <Button size="sm" onClick={() => cmd('undo')} disabled={!stack.undo}>Undo</Button>
            <Button size="sm" onClick={() => cmd('redo')} disabled={!stack.redo}>Redo</Button>
          </div>
          <div className="absolute bottom-2 right-2 flex gap-1">
            <Button size="sm" onClick={() => zoom(1.2)} aria-label="Zoom in">+</Button>
            <Button size="sm" onClick={() => zoom(1 / 1.2)} aria-label="Zoom out">−</Button>
            <Button size="sm" onClick={() => zoom('fit')}>Fit</Button>
          </div>
        </div>
      </div>
    );
  },
);
