import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { isTextEditingTarget } from '../lib/files';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.1;

type Vec2 = { x: number; y: number };

export function useCanvasPanZoom(enabled: boolean) {
  const [pan, setPan] = useState<Vec2>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ pan: Vec2; cursor: Vec2 } | null>(null);

  useEffect(() => {
    if (!enabled) {
      setIsSpaceDown(false);
      setIsPanning(false);
      return;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        if (isTextEditingTarget(e.target)) return;
        if (e.repeat) return;
        e.preventDefault();
        setIsSpaceDown(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setPan({ x: 0, y: 0 });
        setZoom(1);
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        setIsSpaceDown(false);
        setIsPanning(false);
        panStart.current = null;
      }
    }
    function onBlur() {
      setIsSpaceDown(false);
      setIsPanning(false);
      panStart.current = null;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const middleButton = e.button === 1;
      if (!isSpaceDown && !middleButton) return false;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panStart.current = { pan, cursor: { x: e.clientX, y: e.clientY } };
      setIsPanning(true);
      return true;
    },
    [isSpaceDown, pan],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!isPanning || !panStart.current) return;
      const start = panStart.current;
      setPan({
        x: start.pan.x + (e.clientX - start.cursor.x),
        y: start.pan.y + (e.clientY - start.cursor.y),
      });
    },
    [isPanning],
  );

  const onPointerUp = useCallback(() => {
    if (!isPanning) return;
    setIsPanning(false);
    panStart.current = null;
  }, [isPanning]);

  const onWheel = useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
        if (nextZoom === zoom) return;
        const ratio = nextZoom / zoom;
        setZoom(nextZoom);
        setPan({
          x: cx - (cx - pan.x) * ratio,
          y: cy - (cy - pan.y) * ratio,
        });
        return;
      }
      // Scroll wheel without Ctrl pans the canvas
      e.preventDefault();
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    },
    [pan, zoom],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number, viewportRect: DOMRect) => ({
      x: (clientX - viewportRect.left - pan.x) / zoom,
      y: (clientY - viewportRect.top - pan.y) / zoom,
    }),
    [pan, zoom],
  );

  const reset = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  return {
    pan,
    zoom,
    isSpaceDown,
    isPanning,
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    canvasClass: isPanning ? 'panning' : isSpaceDown ? 'space-mode' : '',
    bindings: { onPointerDown, onPointerMove, onPointerUp, onWheel },
    screenToWorld,
    reset,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
