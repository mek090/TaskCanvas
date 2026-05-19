import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { isTextEditingTarget } from '../lib/files';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.1;
const MIN_FRAME_VISIBLE = 140;

type Vec2 = { x: number; y: number };
export type WorldBounds = { x: number; y: number; width: number; height: number };

type Options = {
  enabled: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
  bounds: WorldBounds;
};

export function useCanvasPanZoom({ enabled, viewportRef, bounds }: Options) {
  const [pan, setPanRaw] = useState<Vec2>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 1, height: 1 });
  const [isSpaceDown, setIsSpaceDown] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef<{ pan: Vec2; cursor: Vec2 } | null>(null);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  const clampPan = useCallback(
    (p: Vec2, z: number): Vec2 => {
      const vx = viewport.width;
      const vy = viewport.height;
      const bx = bounds.x * z;
      const by = bounds.y * z;
      const bw = bounds.width * z;
      const bh = bounds.height * z;

      let minX = MIN_FRAME_VISIBLE - bx - bw;
      let maxX = vx - MIN_FRAME_VISIBLE - bx;
      let minY = MIN_FRAME_VISIBLE - by - bh;
      let maxY = vy - MIN_FRAME_VISIBLE - by;
      if (minX > maxX) [minX, maxX] = [maxX, minX];
      if (minY > maxY) [minY, maxY] = [maxY, minY];
      return {
        x: clamp(p.x, minX, maxX),
        y: clamp(p.y, minY, maxY),
      };
    },
    [bounds.height, bounds.width, bounds.x, bounds.y, viewport.height, viewport.width],
  );

  const setPan = useCallback(
    (next: Vec2 | ((prev: Vec2) => Vec2)) => {
      setPanRaw((prev) => clampPan(typeof next === 'function' ? next(prev) : next, zoom));
    },
    [clampPan, zoom],
  );

  // Re-clamp when bounds, zoom, or viewport changes so frame stays in view.
  useEffect(() => {
    setPanRaw((prev) => clampPan(prev, zoom));
  }, [clampPan, zoom]);

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
        setPanRaw({ x: 0, y: 0 });
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
    [isPanning, setPan],
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
        const nextPan = clampPan(
          {
            x: cx - (cx - pan.x) * ratio,
            y: cy - (cy - pan.y) * ratio,
          },
          nextZoom,
        );
        setZoom(nextZoom);
        setPanRaw(nextPan);
        return;
      }
      e.preventDefault();
      setPan((prev) => ({
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    },
    [clampPan, pan, setPan, zoom],
  );

  const screenToWorld = useCallback(
    (clientX: number, clientY: number, viewportRect: DOMRect) => ({
      x: (clientX - viewportRect.left - pan.x) / zoom,
      y: (clientY - viewportRect.top - pan.y) / zoom,
    }),
    [pan, zoom],
  );

  const reset = useCallback(() => {
    setZoom(1);
    setPanRaw(clampPan({ x: 0, y: 0 }, 1));
  }, [clampPan]);

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
