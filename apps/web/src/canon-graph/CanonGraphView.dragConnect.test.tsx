import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanonGraphView } from './CanonGraphView';
import { post } from '../lib/post';

vi.mock('../lib/post', () => ({
  post: vi.fn().mockResolvedValue({ ok: true, contractId: 'ct_test_123' }),
}));

describe('CanonGraphView · Drag-to-Connect 交互与全链路闭环', () => {
  const mockBook = {
    root: 'C:\\tmp\\test-book',
    bookId: 'bk_graph_01',
    title: '正典神识录',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('链路 1：从节点 Connection Handle 拖拽至目标节点 -> 唤起契约弹窗 -> 确认提交入典', async () => {
    render(<CanonGraphView book={mockBook} />);

    expect(screen.getByText('正典关系与因果拓扑 · 《正典神识录》')).toBeInTheDocument();
    const handleC1 = screen.getByTestId('connection-handle-c1');
    const nodeC2 = screen.getByTestId('graph-node-c2');
    expect(handleC1).toBeInTheDocument();

    // 1. PointerDown 发起连线
    fireEvent.pointerDown(handleC1);

    // 状态栏显示拖拽指示，出现临时连线
    expect(screen.getByTestId('temp-connection-line')).toBeInTheDocument();
    expect(screen.getByText(/正在从「林守常」拖拽连线/)).toBeInTheDocument();

    // 2. 悬停进入陈九安 (c2)
    fireEvent.pointerEnter(nodeC2);
    expect(screen.getByTestId('highlight-target-c2')).toBeInTheDocument();

    // 3. PointerUp 在陈九安处释放
    fireEvent.pointerUp(nodeC2);

    // 临时线消除，打开 CreateContractModal
    expect(screen.queryByTestId('temp-connection-line')).not.toBeInTheDocument();
    expect(screen.getByText('建立因果契约 (CausalContract)')).toBeInTheDocument();
    expect(screen.getAllByText('林守常').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('陈九安').length).toBeGreaterThanOrEqual(1);

    // 4. 在弹窗中填写契约承诺并提交
    const summaryInput = screen.getByPlaceholderText(/立誓三月内替对方找齐三味续命主药/);
    fireEvent.change(summaryInput, { target: { value: '三年内共赴东海斩妖' } });

    const submitBtn = screen.getByText('确认入典');
    fireEvent.click(submitBtn);

    // 弹窗关闭，后端 post 收到调用，界面更新为成功提示
    await waitFor(() => {
      expect(screen.queryByText('建立因果契约 (CausalContract)')).not.toBeInTheDocument();
    });

    expect(post).toHaveBeenCalledWith('/api/story-brain.contract', expect.objectContaining({
      root: mockBook.root,
      sourceName: '林守常',
      targetName: '陈九安',
      summary: '三年内共赴东海斩妖',
    }));

    expect(screen.getByText(/已成功建立「林守常」与「陈九安」/)).toBeInTheDocument();
  });

  it('链路 2：Self-link 拒绝保护 —— 拖拽回起点自身时拒绝并提示，不打开弹窗', () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC1 = screen.getByTestId('connection-handle-c1');
    const nodeC1 = screen.getByTestId('graph-node-c1');

    // 从 c1 出发
    fireEvent.pointerDown(handleC1);
    // 移动回自身
    fireEvent.pointerEnter(nodeC1);
    // 释放
    fireEvent.pointerUp(nodeC1);

    // 弹窗不应出现，状态栏应报拒绝自连
    expect(screen.queryByText('建立因果契约 (CausalContract)')).not.toBeInTheDocument();
    expect(screen.getByText('拒绝自连：不可与实体自身建立因果契约')).toBeInTheDocument();
  });

  it('链路 3：Duplicate-link 处理 —— 检测到已有因果连接时提供提示并不阻断建立新层级契约', () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC1 = screen.getByTestId('connection-handle-c1');
    const nodeC2 = screen.getByTestId('graph-node-c2');

    // c1 与 c2 在 DEFAULT_LINKS 中已有关系
    fireEvent.pointerDown(handleC1);
    fireEvent.pointerEnter(nodeC2);
    fireEvent.pointerUp(nodeC2);

    // 仍能正常唤起弹窗，且状态栏提示“已有因果连接”
    expect(screen.getByText('建立因果契约 (CausalContract)')).toBeInTheDocument();
    expect(screen.getByText(/已有因果连接，将追加新契约约定/)).toBeInTheDocument();
  });

  it('链路 4：Undo 撤销操作 —— 成功建连后可通过按钮或 Ctrl+Z 撤销', async () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC3 = screen.getByTestId('connection-handle-c3'); // 张老伯
    const nodeC4 = screen.getByTestId('graph-node-c4'); // 白骨真人

    // 初始状态下无 undo 按钮
    expect(screen.queryByTestId('undo-link-button')).not.toBeInTheDocument();

    // 连向 白骨真人 c4
    fireEvent.pointerDown(handleC3);
    fireEvent.pointerEnter(nodeC4);
    fireEvent.pointerUp(nodeC4);

    // 填写弹窗并入典
    const summaryInput = screen.getByPlaceholderText(/立誓三月内替对方找齐三味续命主药/);
    fireEvent.change(summaryInput, { target: { value: '暗中通风报信' } });
    fireEvent.click(screen.getByText('确认入典'));

    // 出现撤销按钮及计数
    await waitFor(() => {
      expect(screen.getByTestId('undo-link-button')).toBeInTheDocument();
    });
    expect(screen.getByText(/可撤销 \(1\)/)).toBeInTheDocument();

    // 点击撤销按钮
    const undoBtn = screen.getByTestId('undo-link-button');
    fireEvent.click(undoBtn);

    // 撤销后撤销按钮消失，并显示撤销反馈
    expect(screen.queryByTestId('undo-link-button')).not.toBeInTheDocument();
    expect(screen.getByText(/已撤销.*因果契约连线/)).toBeInTheDocument();
  });

  it('链路 5：触屏 Pointer Event 与 PointerCancel 安全取消', () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC1 = screen.getByTestId('connection-handle-c1');
    const svg = screen.getByLabelText('正典实体关系因果拓扑图');

    // 模拟触屏 touch pointerDown
    fireEvent.pointerDown(handleC1, { pointerType: 'touch' });
    expect(screen.getByTestId('temp-connection-line')).toBeInTheDocument();

    // 触屏滑动
    fireEvent.pointerMove(svg, { pointerType: 'touch' });
    expect(screen.getByTestId('temp-connection-line')).toBeInTheDocument();

    // 触发 pointerCancel（如系统手势切出）
    fireEvent.pointerCancel(svg);
    expect(screen.queryByTestId('temp-connection-line')).not.toBeInTheDocument();
    expect(screen.getByText('连线交互已取消')).toBeInTheDocument();
  });

  it('链路 6：键盘操作路径 —— 节点/Handle 回车进入键盘连线模式，回车目标节点建立契约', () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC1 = screen.getByTestId('connection-handle-c1');

    // 在 handle 上按 Enter 触发键盘连线模式
    fireEvent.keyDown(handleC1, { key: 'Enter' });
    expect(screen.getByTestId('keyboard-connecting-banner')).toBeInTheDocument();
    expect(screen.getByText(/已选择连线起点实体/)).toBeInTheDocument();

    // 键盘移动到陈九安节点 c2 并按 Enter
    const nodeC2 = screen.getByTestId('graph-node-c2');
    fireEvent.keyDown(nodeC2, { key: 'Enter' });

    // 成功打开契约弹窗
    expect(screen.getByText('建立因果契约 (CausalContract)')).toBeInTheDocument();
  });

  it('链路 7：键盘按 Esc 取消连线模式', () => {
    render(<CanonGraphView book={mockBook} />);
    const handleC1 = screen.getByTestId('connection-handle-c1');

    fireEvent.keyDown(handleC1, { key: 'Enter' });
    expect(screen.getByTestId('keyboard-connecting-banner')).toBeInTheDocument();

    // 按 Esc 键
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('keyboard-connecting-banner')).not.toBeInTheDocument();
    expect(screen.getByText('键盘连线模式已退出')).toBeInTheDocument();
  });

  it('链路 8：无障碍表单 Fallback —— 选中实体后通过下拉列表建立契约', () => {
    render(<CanonGraphView book={mockBook} />);
    const nodeC1 = screen.getByTestId('graph-node-c1');

    // 点击选中林守常
    fireEvent.click(nodeC1);

    // 顶部出现无障碍契约按钮
    const connectBtn = screen.getByTestId('accessible-connect-button');
    expect(connectBtn).toBeInTheDocument();
    fireEvent.click(connectBtn);

    // 展开无障碍目标选择弹层
    expect(screen.getByTestId('accessible-target-dialog')).toBeInTheDocument();
    const select = screen.getByTestId('accessible-target-select');

    // 切换到目标白骨真人 c4
    fireEvent.change(select, { target: { value: 'c4' } });
    fireEvent.click(screen.getByTestId('accessible-target-confirm'));

    // 打开契约弹窗
    expect(screen.getByText('建立因果契约 (CausalContract)')).toBeInTheDocument();
    expect(screen.getAllByText('林守常').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('白骨真人').length).toBeGreaterThanOrEqual(1);
  });
});
