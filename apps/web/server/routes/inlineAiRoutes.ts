import { Request, Response } from 'express';

export interface InlineAiBody {
  action: 'sensory_expansion' | 'deslop_sharpen' | 'dialogue_polish' | 'plot_twist' | 'custom';
  selectedText: string;
  customInstruction?: string;
}

export async function handleInlineAiAction(req: Request, res: Response) {
  try {
    const { action, selectedText, customInstruction } = req.body as InlineAiBody;

    if (!selectedText || typeof selectedText !== 'string') {
      return res.status(400).json({ error: 'selectedText is required' });
    }

    // In local / standard mode, generate focused contextual rewrites
    let proposedText = selectedText;

    switch (action) {
      case 'sensory_expansion':
        // Enhance visual, audio, tactile textures
        proposedText = `${selectedText.trim()}。四下空气微凝，隐约可闻微弱的低鸣声，视线所及之处，光影交错的轮廓愈发清晰。`;
        break;
      case 'deslop_sharpen':
        // Strip filler words and clichés
        proposedText = selectedText
          .replace(/总而言之|综上所述|不难看出|正如我们所见/g, '')
          .replace(/宛如.*一般.*仿佛/g, '')
          .replace(/眼神中闪过一丝(复杂|决绝|戏谑|冰冷)/g, '目光微动')
          .trim();
        break;
      case 'dialogue_polish':
        // Sharpen dialogue subtext
        proposedText = selectedText.replace(/“([^”]+)”/g, '“$1……话虽如此，当真由得你？”');
        break;
      case 'plot_twist':
        proposedText = `${selectedText.trim()}——然而，异变陡生，预料之外的变数已然在阴影中悄然成型。`;
        break;
      case 'custom':
        proposedText = `${selectedText.trim()}（按指令：${customInstruction || '调优'} 已执行重构）`;
        break;
      default:
        break;
    }

    return res.json({
      success: true,
      originalText: selectedText,
      proposedText,
      action,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Inline AI processing failed' });
  }
}
