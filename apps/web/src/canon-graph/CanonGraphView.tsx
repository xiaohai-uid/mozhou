import React, { useState, useRef, useEffect } from 'react';
import { useCanonGraphData } from './useCanonGraphData';
import type { GraphNode, GraphLink } from './useCanonGraphData';
import { CanonNodeCard } from './CanonNodeCard';
import { CreateContractModal } from './CreateContractModal';
import { CreateEntityModal } from '../story-brain/CreateEntityModal';
import { post } from '../lib/post';
import type { BookInfo } from '../shell/workbenchStorage';

const FILTERS = [
  ['all', '全部'],
  ['character', '人物'],
  ['faction', '势力'],
  ['location', '地点'],
  ['item', '道具'],
] as const;

function nodeTone(type: GraphNode['type']): string {
  switch (type) {
    case 'character':
      return 'var(--jade)';
    case 'faction':
      return 'var(--success)';
    case 'location':
      return 'var(--text-muted)';
    case 'item':
      return 'var(--gold)';
  }
}

export interface DragConnectingState {
  source: GraphNode;
  currentPos: { x: number; y: number };
  hoveredTargetId: string | null;
  isSelf: boolean;
  isDuplicate: boolean;
}

export const CanonGraphView: React.FC<{ book?: BookInfo | null | undefined }> = ({ book }) => {
  const { nodes, links, isLive, isDemo, isEmpty, addLink, removeLink, reload } = useCanonGraphData(book?.root);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [contractTarget, setContractTarget] = useState<GraphNode | null>(null);
  const [entityModalOpen, setEntityModalOpen] = useState(false);

  // Drag-to-connect 状态
  const [connecting, setConnecting] = useState<DragConnectingState | null>(null);
  // 键盘连线模式起点
  const [keyboardConnectingSource, setKeyboardConnectingSource] = useState<GraphNode | null>(null);
  // Undo 撤销栈
  const [undoStack, setUndoStack] = useState<GraphLink[]>([]);
  // 状态反馈消息（用于 UI 与 ARIA 辅助技术）
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);
  // 无障碍 Fallback 目标选择弹层/选择框
  const [fallbackTargetId, setFallbackTargetId] = useState<string>('');
  const [accessibleSelectOpen, setAccessibleSelectOpen] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);

  // 快捷键监听：Escape 取消、Ctrl+Z/Cmd+Z 撤销
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (connecting) {
          setConnecting(null);
          setStatusMessage({ text: '拖拽连线已取消', type: 'info' });
        }
        if (keyboardConnectingSource) {
          setKeyboardConnectingSource(null);
          setStatusMessage({ text: '键盘连线模式已退出', type: 'info' });
        }
        if (accessibleSelectOpen) {
          setAccessibleSelectOpen(false);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [connecting, keyboardConnectingSource, undoStack, nodes, accessibleSelectOpen]);

  const handleSaveEntity = async (entity: {
    cardType: 'char' | 'location' | 'item' | 'faction' | 'concept';
    name: string;
    brief: string;
    details: string;
  }): Promise<void> => {
    if (book?.root) {
      await post('/api/story-brain.entity.save', {
        root: book.root,
        ...entity,
      });
      reload();
    }
  };

  const filteredNodes = nodes.filter((node) => (filterType === 'all' ? true : node.type === filterType));

  // 坐标转换工具函数（安全防 NaN）
  const getSvgCoordinates = (clientX?: number, clientY?: number, fallbackNode?: GraphNode): { x: number; y: number } => {
    const rawX = Number.isFinite(clientX) ? (clientX as number) : (fallbackNode ? fallbackNode.x + 24 : 0);
    const rawY = Number.isFinite(clientY) ? (clientY as number) : (fallbackNode ? fallbackNode.y : 0);

    if (svgRef.current) {
      const svg = svgRef.current;
      if (typeof svg.createSVGPoint === 'function' && typeof svg.getScreenCTM === 'function') {
        try {
          const pt = svg.createSVGPoint();
          pt.x = rawX;
          pt.y = rawY;
          const ctm = svg.getScreenCTM();
          if (ctm) {
            const transformed = pt.matrixTransform(ctm.inverse());
            if (Number.isFinite(transformed.x) && Number.isFinite(transformed.y)) {
              return { x: Math.round(transformed.x), y: Math.round(transformed.y) };
            }
          }
        } catch {
          // fallback
        }
      }
      const rect = svg.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.height > 0) {
        const x = ((rawX - rect.left) / rect.width) * 760;
        const y = ((rawY - rect.top) / rect.height) * 520;
        if (Number.isFinite(x) && Number.isFinite(y)) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    return { x: Math.round(rawX), y: Math.round(rawY) };
  };

  // 检测指定坐标下的节点（半径 35 容差，方便触屏操作）
  const findNodeAtPosition = (pos: { x: number; y: number }): GraphNode | null => {
    for (const node of nodes) {
      const dist = Math.hypot(node.x - pos.x, node.y - pos.y);
      if (dist <= 35) {
        return node;
      }
    }
    return null;
  };

  // Connection Handle pointer down 开始拖拽连线
  const handleHandlePointerDown = (sourceNode: GraphNode, event: React.PointerEvent) => {
    event.stopPropagation();
    const pos = getSvgCoordinates(event.clientX, event.clientY, sourceNode);
    setConnecting({
      source: sourceNode,
      currentPos: pos,
      hoveredTargetId: null,
      isSelf: false,
      isDuplicate: false,
    });
    setStatusMessage({
      text: `正在从「${sourceNode.name}」拖拽连线，请拖到目标实体并松开`,
      type: 'info',
    });
  };

  // 画布 PointerMove
  const handleSvgPointerMove = (event: React.PointerEvent) => {
    if (!connecting) return;
    const pos = getSvgCoordinates(event.clientX, event.clientY, connecting.source);
    const hitNode = findNodeAtPosition(pos);
    const isSelf = Boolean(hitNode && hitNode.id === connecting.source.id);
    const isDuplicate = Boolean(
      hitNode &&
      !isSelf &&
      links.some(
        (l) =>
          (l.source === connecting.source.id && l.target === hitNode.id) ||
          (l.source === hitNode.id && l.target === connecting.source.id)
      )
    );

    setConnecting((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        currentPos: pos,
        hoveredTargetId: hitNode ? hitNode.id : null,
        isSelf,
        isDuplicate,
      };
    });
  };

  // 释放连线并进入契约创建逻辑
  const handleFinishConnecting = (targetNode: GraphNode) => {
    if (!connecting) return;
    const source = connecting.source;
    setConnecting(null);

    // 1. Self-link 拒绝
    if (targetNode.id === source.id) {
      setStatusMessage({
        text: '拒绝自连：不可与实体自身建立因果契约',
        type: 'error',
      });
      return;
    }

    // 2. Duplicate-link 处理
    const isDuplicate = links.some(
      (l) =>
        (l.source === source.id && l.target === targetNode.id) ||
        (l.source === targetNode.id && l.target === source.id)
    );

    if (isDuplicate) {
      setStatusMessage({
        text: `提示：「${source.name}」与「${targetNode.name}」已有因果连接，将追加新契约约定`,
        type: 'info',
      });
    }

    // 3. 打开 CreateContractModal，让作者选择契约内容
    setSelectedNode(source);
    setContractTarget(targetNode);
    setModalOpen(true);
  };

  // 画布 PointerUp：落点检测与契约弹窗
  const handleSvgPointerUp = (event: React.PointerEvent) => {
    if (!connecting) return;
    const pos = getSvgCoordinates(event.clientX, event.clientY, connecting.source);
    const hitNode = findNodeAtPosition(pos);
    if (hitNode) {
      handleFinishConnecting(hitNode);
    } else {
      setConnecting(null);
      setStatusMessage({
        text: '连线已取消：未拖至目标实体',
        type: 'info',
      });
    }
  };

  const handleSvgPointerCancel = () => {
    if (connecting) {
      setConnecting(null);
      setStatusMessage({ text: '连线交互已取消', type: 'info' });
    }
  };

  // 键盘操作路径：启动/确认连线
  const handleStartKeyboardConnecting = (source: GraphNode) => {
    setKeyboardConnectingSource(source);
    setStatusMessage({
      text: `【键盘连线模式】已选择起点「${source.name}」，请选择目标实体按 Enter 建立契约，按 Esc 取消`,
      type: 'info',
    });
  };

  const handleKeyboardTargetSelect = (target: GraphNode) => {
    if (!keyboardConnectingSource) return;
    const source = keyboardConnectingSource;
    setKeyboardConnectingSource(null);

    if (target.id === source.id) {
      setStatusMessage({
        text: '拒绝自连：不可与实体自身建立因果契约',
        type: 'error',
      });
      return;
    }

    const isDuplicate = links.some(
      (l) =>
        (l.source === source.id && l.target === target.id) ||
        (l.source === target.id && l.target === source.id)
    );
    if (isDuplicate) {
      setStatusMessage({
        text: `提示：「${source.name}」与「${target.name}」已有因果连接，将追加新契约约定`,
        type: 'info',
      });
    }

    setSelectedNode(source);
    setContractTarget(target);
    setModalOpen(true);
  };

  // 无障碍 Fallback：打开目标实体选择列表
  const handleOpenAccessibleTargetSelect = (source: GraphNode) => {
    setSelectedNode(source);
    const availableTargets = nodes.filter((n) => n.id !== source.id);
    if (availableTargets.length > 0) {
      setFallbackTargetId(availableTargets[0]!.id);
      setAccessibleSelectOpen(true);
    } else {
      setStatusMessage({ text: '当前图中没有其他实体可建立契约', type: 'error' });
    }
  };

  const handleConfirmAccessibleTarget = () => {
    if (!selectedNode || !fallbackTargetId) return;
    const target = nodes.find((n) => n.id === fallbackTargetId);
    if (!target) return;
    if (target.id === selectedNode.id) {
      setStatusMessage({ text: '拒绝自连：不可与实体自身建立因果契约', type: 'error' });
      return;
    }
    setAccessibleSelectOpen(false);
    setContractTarget(target);
    setModalOpen(true);
  };

  // 创建契约并入典（支持 Undo 栈）
  const handleCreateContract = (contract: {
    relation: string;
    summary: string;
    deadline?: string;
    penalty?: string;
  }): void => {
    if (!selectedNode || !contractTarget) return;
    const newLink: GraphLink = {
      source: selectedNode.id,
      target: contractTarget.id,
      relation: contract.relation,
      contract: {
        summary: contract.summary,
        status: 'ACTIVE',
        deadline: contract.deadline,
        penalty: contract.penalty,
      },
    };
    addLink(newLink);
    setUndoStack((prev) => [...prev, newLink]);
    setStatusMessage({
      text: `已成功建立「${selectedNode.name}」与「${contractTarget.name}」的「${contract.relation}」因果契约`,
      type: 'success',
    });

    if (book?.root) {
      void post('/api/story-brain.contract', {
        root: book.root,
        sourceName: selectedNode.name,
        targetName: contractTarget.name,
        relation: contract.relation,
        summary: contract.summary,
        deadline: contract.deadline,
        penalty: contract.penalty,
      }).catch((error: unknown) => {
        console.error('Failed to sync contract to backend', error);
      });
    }
  };

  // Undo 撤销最近一次建立的契约
  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const lastLink = undoStack[undoStack.length - 1];
    if (!lastLink) return;
    setUndoStack((prev) => prev.slice(0, -1));
    removeLink((l) => l.source === lastLink.source && l.target === lastLink.target && l.relation === lastLink.relation);
    const sName = nodes.find((n) => n.id === lastLink.source)?.name || lastLink.source;
    const tName = nodes.find((n) => n.id === lastLink.target)?.name || lastLink.target;
    setStatusMessage({
      text: `已撤销「${sName}」与「${tName}」的因果契约连线`,
      type: 'info',
    });
  };

  const statusLabel = isLive ? (isEmpty ? '空正典' : '实时正典') : isDemo ? '示例演示' : '未连接';

  return (
    <section className="flex h-full min-h-[600px] w-full flex-col overflow-hidden border border-[var(--hairline-strong)] bg-[var(--surface-sunken)]" aria-labelledby="canon-graph-title">
      <header className="flex flex-col gap-3 border-b border-[var(--hairline)] bg-[var(--surface)] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
            <h2 id="canon-graph-title" className="m-0 text-sm font-semibold text-[var(--foreground)]">
              正典关系与因果拓扑 {book ? `· 《${book.title}》` : ''}
            </h2>
            <span className="rounded-md bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)]">
              {nodes.length} 实体 · {links.length} 关系 · {statusLabel}
            </span>
            {undoStack.length > 0 && (
              <span className="rounded bg-[var(--gold-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--gold-bright)]">
                可撤销 ({undoStack.length})
              </span>
            )}
          </div>
          <p className="mt-1.5 max-w-2xl text-[11.5px] leading-5 text-[var(--text-faint)]">
            展示人物、势力、地点与道具之间的正典关系。支持节点连线手势拖拽（Drag to Connect）或键盘连线建立因果契约。
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {undoStack.length > 0 && (
            <button
              type="button"
              onClick={handleUndo}
              data-testid="undo-link-button"
              className="min-h-8 rounded-md border border-[var(--hairline)] bg-[var(--surface-2)] px-2.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)] active:scale-[0.96]"
              title="撤销最近一次连线契约 (Ctrl+Z)"
            >
              ↶ 撤销连线
            </button>
          )}

          {selectedNode && (
            <button
              type="button"
              onClick={() => handleOpenAccessibleTargetSelect(selectedNode)}
              data-testid="accessible-connect-button"
              className="min-h-10 rounded-lg bg-[var(--gold-bright)] px-3.5 text-xs font-semibold text-[var(--background)] transition-[background-color,transform] duration-150 hover:bg-[var(--gold)] active:scale-[0.96]"
            >
              与「{selectedNode.name}」建立契约
            </button>
          )}

          <button
            type="button"
            onClick={() => setEntityModalOpen(true)}
            className="min-h-8 rounded-md bg-[var(--gold-soft)] px-3 text-[11px] font-medium text-[var(--gold-bright)] shadow-[inset_0_0_0_1px_var(--gold-line-soft)] hover:bg-[var(--gold-line-soft)] active:scale-[0.96]"
          >
            + 新建设定卡
          </button>
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1" aria-label="实体类型筛选">
            {FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filterType === id}
                onClick={() => setFilterType(id)}
                className={`min-h-8 rounded-md px-2.5 text-[11px] transition-[background-color,color,transform] duration-150 active:scale-[0.96] ${
                  filterType === id
                    ? 'bg-[var(--gold-soft)] font-medium text-[var(--gold-bright)] shadow-[inset_0_0_0_1px_var(--gold-line-soft)]'
                    : 'text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* 实时状态提示与无障碍播报区 */}
      {statusMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid="graph-status-bar"
          className={`flex items-center justify-between border-b px-6 py-2 text-xs transition-colors ${
            statusMessage.type === 'error'
              ? 'border-red-500/30 bg-red-500/10 text-red-300'
              : statusMessage.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-[var(--hairline)] bg-[var(--surface-2)] text-[var(--text-muted)]'
          }`}
        >
          <span>{statusMessage.text}</span>
          <button
            type="button"
            onClick={() => setStatusMessage(null)}
            className="ml-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--foreground)]"
            aria-label="关闭状态提示"
          >
            ✕
          </button>
        </div>
      )}

      {/* 键盘连线模式醒目横幅 */}
      {keyboardConnectingSource && (
        <div
          data-testid="keyboard-connecting-banner"
          className="flex items-center justify-between border-b border-[var(--gold-line)] bg-[var(--gold-soft)] px-6 py-2.5 text-xs text-[var(--gold-bright)]"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 animate-ping rounded-full bg-[var(--gold-bright)]" />
            <span>
              已选择连线起点实体：<b>{keyboardConnectingSource.name}</b>。请点击或聚焦目标实体按 Enter 建立契约，按 Esc 取消。
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setKeyboardConnectingSource(null);
              setStatusMessage({ text: '键盘连线模式已取消', type: 'info' });
            }}
            className="rounded border border-[var(--gold-line)] px-2 py-0.5 text-[11px] hover:bg-[var(--surface-raised)]"
          >
            取消连线 (Esc)
          </button>
        </div>
      )}

      {/* 无障碍表单 Fallback 目标选择浮层 */}
      {accessibleSelectOpen && selectedNode && (
        <div
          data-testid="accessible-target-dialog"
          className="flex items-center gap-3 border-b border-[var(--hairline)] bg-[var(--surface-raised)] px-6 py-3 text-xs"
        >
          <span className="font-medium text-[var(--foreground)]">从「{selectedNode.name}」连线至：</span>
          <select
            data-testid="accessible-target-select"
            value={fallbackTargetId}
            onChange={(e) => setFallbackTargetId(e.target.value)}
            className="rounded border border-[var(--hairline-strong)] bg-[var(--surface-sunken)] px-3 py-1.5 text-xs text-[var(--foreground)] outline-none focus:border-[var(--gold-line)]"
          >
            {nodes
              .filter((n) => n.id !== selectedNode.id)
              .map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.type === 'character' ? '人物' : n.type === 'faction' ? '势力' : n.type === 'location' ? '地点' : '道具'})
                </option>
              ))}
          </select>
          <button
            type="button"
            data-testid="accessible-target-confirm"
            onClick={handleConfirmAccessibleTarget}
            className="rounded bg-[var(--gold-bright)] px-3 py-1.5 font-medium text-[var(--background)] hover:bg-[var(--gold)]"
          >
            下一步：设定契约
          </button>
          <button
            type="button"
            onClick={() => setAccessibleSelectOpen(false)}
            className="rounded border border-[var(--hairline)] px-2.5 py-1.5 text-[var(--text-muted)] hover:text-[var(--foreground)]"
          >
            取消
          </button>
        </div>
      )}

      {isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center bg-[var(--surface-raised)] p-8 text-center">
          <div className="mb-3 grid h-12 w-12 place-items-center rounded-xl bg-[var(--jade-soft)] font-serif text-lg font-semibold text-[var(--accent-strong)] shadow-[inset_0_0_0_1px_var(--jade-line-soft)]" aria-hidden="true">
            典
          </div>
          <b className="text-sm text-[var(--foreground)]">《{book?.title ?? '当前作品'}》尚无正典实体卡</b>
          <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[var(--text-muted)]">
            当前书库未检测到人物、势力、地点或道具设定卡。可以直接在下方点击创建卡片，图谱会按真实数据更新。
          </p>
          <button
            type="button"
            onClick={() => setEntityModalOpen(true)}
            className="mt-4 rounded-md bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-[var(--background)] shadow-sm hover:bg-[var(--accent-strong)] active:scale-[0.96]"
          >
            立即创建第一张设定卡
          </button>
        </div>
      ) : (
        <div className="relative flex-1 overflow-hidden bg-[var(--surface-raised)]">
          <svg
            ref={svgRef}
            className="h-full w-full select-none"
            style={{ touchAction: 'none' }}
            viewBox="0 0 760 520"
            preserveAspectRatio="xMidYMid meet"
            aria-label="正典实体关系因果拓扑图"
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerCancel}
          >
            {/* 绘制现有关系连线 */}
            {links.map((link, index) => {
              const sourceNode = nodes.find((node) => node.id === link.source);
              const targetNode = nodes.find((node) => node.id === link.target);
              if (!sourceNode || !targetNode) return null;

              const isContract = Boolean(link.contract);
              const midX = (sourceNode.x + targetNode.x) / 2;
              const midY = (sourceNode.y + targetNode.y) / 2;

              return (
                <g key={index} data-testid={`graph-link-${link.source}-${link.target}`}>
                  <line
                    x1={sourceNode.x}
                    y1={sourceNode.y}
                    x2={targetNode.x}
                    y2={targetNode.y}
                    stroke={isContract ? 'var(--gold)' : 'var(--text-faint)'}
                    strokeWidth={isContract ? 2 : 1.3}
                    strokeDasharray={isContract ? '5 4' : undefined}
                    opacity={0.8}
                  />
                  <rect
                    x={midX - 34}
                    y={midY - 14}
                    width={68}
                    height={18}
                    rx={5}
                    fill="var(--surface)"
                    stroke={isContract ? 'var(--gold-line-soft)' : 'var(--hairline-strong)'}
                  />
                  <text
                    x={midX}
                    y={midY - 2}
                    fill={isContract ? 'var(--gold-bright)' : 'var(--text-muted)'}
                    fontSize="9.5"
                    textAnchor="middle"
                    className="pointer-events-none select-none"
                  >
                    {link.relation}
                  </text>
                </g>
              );
            })}

            {/* 拖拽中的临时交互连线 */}
            {connecting && (
              <g data-testid="temp-connection-group" className="pointer-events-none">
                <line
                  data-testid="temp-connection-line"
                  x1={connecting.source.x}
                  y1={connecting.source.y}
                  x2={connecting.currentPos.x}
                  y2={connecting.currentPos.y}
                  stroke={
                    connecting.isSelf
                      ? '#ef4444'
                      : connecting.isDuplicate
                      ? '#f59e0b'
                      : 'var(--gold-bright)'
                  }
                  strokeWidth={2.5}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                />
                <circle
                  cx={connecting.currentPos.x}
                  cy={connecting.currentPos.y}
                  r={6}
                  fill={
                    connecting.isSelf
                      ? '#ef4444'
                      : connecting.isDuplicate
                      ? '#f59e0b'
                      : 'var(--gold-bright)'
                  }
                  opacity={0.85}
                />
              </g>
            )}

            {/* 绘制所有实体节点 */}
            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.id === node.id;
              const isKeyboardSource = keyboardConnectingSource?.id === node.id;
              const isDragSource = connecting?.source.id === node.id;
              const isHoveredTarget = connecting?.hoveredTargetId === node.id;
              const tone = nodeTone(node.type);

              return (
                <g
                  key={node.id}
                  data-testid={`graph-node-${node.id}`}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => {
                    if (keyboardConnectingSource && keyboardConnectingSource.id !== node.id) {
                      handleKeyboardTargetSelect(node);
                    } else if (!keyboardConnectingSource) {
                      setSelectedNode(node);
                    }
                  }}
                  onPointerEnter={() => {
                    if (connecting) {
                      const isSelf = connecting.source.id === node.id;
                      const isDuplicate = !isSelf && links.some(
                        (l) => (l.source === connecting.source.id && l.target === node.id) ||
                               (l.source === node.id && l.target === connecting.source.id)
                      );
                      setConnecting((prev) => prev ? {
                        ...prev,
                        hoveredTargetId: node.id,
                        isSelf,
                        isDuplicate,
                        currentPos: { x: node.x, y: node.y },
                      } : null);
                    }
                  }}
                  onPointerLeave={() => {
                    if (connecting && connecting.hoveredTargetId === node.id) {
                      setConnecting((prev) => prev ? {
                        ...prev,
                        hoveredTargetId: null,
                        isSelf: false,
                        isDuplicate: false,
                      } : null);
                    }
                  }}
                  onPointerUp={(e) => {
                    if (connecting) {
                      e.stopPropagation();
                      handleFinishConnecting(node);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      if (keyboardConnectingSource && keyboardConnectingSource.id !== node.id) {
                        handleKeyboardTargetSelect(node);
                      } else if (!keyboardConnectingSource) {
                        setSelectedNode(node);
                      }
                    } else if (event.key === 'c' || event.key === 'C') {
                      event.preventDefault();
                      handleStartKeyboardConnecting(node);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label={`实体节点：${node.name}，类型：${node.type}`}
                  className="cursor-pointer outline-none"
                >
                  {/* 悬停目标高亮环（Drag hover 或 Keyboard 模式目标） */}
                  {isHoveredTarget && (
                    <circle
                      data-testid={`highlight-target-${node.id}`}
                      r={36}
                      fill="none"
                      stroke={
                        connecting?.isSelf
                          ? '#ef4444'
                          : connecting?.isDuplicate
                          ? '#f59e0b'
                          : 'var(--gold-bright)'
                      }
                      strokeWidth={3}
                      strokeDasharray="5 3"
                    />
                  )}

                  {/* 键盘连线模式起点指示 */}
                  {isKeyboardSource && (
                    <circle
                      data-testid={`keyboard-source-ring-${node.id}`}
                      r={35}
                      fill="none"
                      stroke="var(--gold-bright)"
                      strokeWidth={2}
                      strokeDasharray="4 2"
                    />
                  )}

                  {/* 选中高亮外圈 */}
                  {isSelected && !isHoveredTarget && (
                    <circle
                      r={33}
                      fill="none"
                      stroke={tone}
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      opacity={0.75}
                    />
                  )}

                  {/* 节点主体 */}
                  <circle
                    r={isSelected || isDragSource ? 26 : 23}
                    fill="var(--surface)"
                    stroke={tone}
                    strokeWidth={isSelected || isDragSource ? 3 : 2}
                  />
                  <circle
                    r={isSelected || isDragSource ? 19 : 16}
                    fill={tone}
                    fillOpacity={0.13}
                  />

                  {/* 节点名简写与全名 */}
                  <text
                    textAnchor="middle"
                    dy="4"
                    fill="var(--foreground)"
                    fontSize="10.5"
                    fontWeight="600"
                    className="pointer-events-none select-none"
                  >
                    {node.name.slice(0, 3)}
                  </text>
                  <text
                    textAnchor="middle"
                    dy="40"
                    fill="var(--text-muted)"
                    fontSize="10.5"
                    fontWeight="500"
                    className="pointer-events-none select-none"
                  >
                    {node.name}
                  </text>

                  {/* Connection Handle（连线手柄）：用于拖拽发起连线或键盘 Enter 连线 */}
                  <g
                    data-testid={`connection-handle-${node.id}`}
                    transform="translate(24, 0)"
                    className="cursor-crosshair transition-transform hover:scale-125"
                    onPointerDown={(e) => handleHandlePointerDown(node, e)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartKeyboardConnecting(node);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        handleStartKeyboardConnecting(node);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`从「${node.name}」拉出契约连线`}
                  >
                    <circle
                      r={7}
                      fill="var(--gold-bright)"
                      stroke="var(--surface)"
                      strokeWidth={1.5}
                    />
                    <circle
                      r={3}
                      fill="var(--background)"
                      className="pointer-events-none"
                    />
                  </g>
                </g>
              );
            })}
          </svg>

          {/* 节点详细卡片 */}
          {selectedNode && (
            <CanonNodeCard
              node={selectedNode}
              relatedLinks={links.filter(
                (link) => link.source === selectedNode.id || link.target === selectedNode.id,
              )}
              onClose={() => setSelectedNode(null)}
            />
          )}

          {/* 契约创建弹窗 */}
          {selectedNode && contractTarget && (
            <CreateContractModal
              isOpen={modalOpen}
              onClose={() => {
                setModalOpen(false);
              }}
              sourceName={selectedNode.name}
              targetName={contractTarget.name}
              onCreateContract={handleCreateContract}
            />
          )}
        </div>
      )}

      {/* 实体创建弹窗 */}
      <CreateEntityModal
        isOpen={entityModalOpen}
        onClose={() => setEntityModalOpen(false)}
        onSave={handleSaveEntity}
      />
    </section>
  );
};
