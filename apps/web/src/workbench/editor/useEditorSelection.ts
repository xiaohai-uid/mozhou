import { useState, useEffect, useCallback, RefObject } from 'react';

export interface SelectionState {
  hasSelection: boolean;
  selectedText: string;
  rangeStart: number;
  rangeEnd: number;
  rect: {
    top: number;
    left: number;
    bottom: number;
    right: number;
    width: number;
    height: number;
  } | null;
}

export function useEditorSelection(containerRef: RefObject<HTMLElement | HTMLTextAreaElement>) {
  const [selection, setSelection] = useState<SelectionState>({
    hasSelection: false,
    selectedText: '',
    rangeStart: 0,
    rangeEnd: 0,
    rect: null,
  });

  const clearSelection = useCallback(() => {
    setSelection({
      hasSelection: false,
      selectedText: '',
      rangeStart: 0,
      rangeEnd: 0,
      rect: null,
    });
  }, []);

  const handleSelectionChange = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    if (el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start !== end && end > start) {
        const text = el.value.substring(start, end).trim();
        if (text.length > 0) {
          const elRect = el.getBoundingClientRect();
          setSelection({
            hasSelection: true,
            selectedText: text,
            rangeStart: start,
            rangeEnd: end,
            rect: {
              top: elRect.top + 20,
              left: Math.min(elRect.left + elRect.width / 2, window.innerWidth - 300),
              bottom: elRect.top + 60,
              right: elRect.right,
              width: 200,
              height: 40,
            },
          });
          return;
        }
      }
      clearSelection();
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      clearSelection();
      return;
    }

    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      clearSelection();
      return;
    }

    const text = sel.toString().trim();
    if (text.length === 0) {
      clearSelection();
      return;
    }

    const clientRect = range.getBoundingClientRect();
    setSelection({
      hasSelection: true,
      selectedText: text,
      rangeStart: 0,
      rangeEnd: text.length,
      rect: {
        top: clientRect.top,
        left: clientRect.left + clientRect.width / 2,
        bottom: clientRect.bottom,
        right: clientRect.right,
        width: clientRect.width,
        height: clientRect.height,
      },
    });
  }, [containerRef, clearSelection]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMouseUp = () => {
      setTimeout(handleSelectionChange, 20);
    };

    const onKeyUp = (e: Event) => {
      const kbEvent = e as KeyboardEvent;
      if (kbEvent.key === 'Escape') {
        clearSelection();
      } else {
        setTimeout(handleSelectionChange, 20);
      }
    };

    el.addEventListener('mouseup', onMouseUp);
    el.addEventListener('keyup', onKeyUp);
    document.addEventListener('selectionchange', handleSelectionChange);

    return () => {
      el.removeEventListener('mouseup', onMouseUp);
      el.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('selectionchange', handleSelectionChange);
    };
  }, [containerRef, handleSelectionChange, clearSelection]);

  return { selection, clearSelection };
}
