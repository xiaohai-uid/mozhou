import React, { useState } from 'react';
import type { ChapterExportItem } from './txtCleanExporter';
import { downloadNovelExport } from './exportDownload';

export interface PublicationExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  bookTitle: string;
  synopsis?: string;
  chapters: ChapterExportItem[];
}

export const PublicationExportModal: React.FC<PublicationExportModalProps> = ({
  isOpen,
  onClose,
  bookTitle,
  synopsis = '',
  chapters,
}) => {
  const [format, setFormat] = useState<'txt' | 'docx' | 'epub'>('txt');
  const [downloading, setDownloading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = async () => {
    setDownloading(true);
    setExportError(null);
    try {
      await downloadNovelExport({
        bookTitle,
        format,
        chapters,
        synopsis,
      });
      onClose();
    } catch (e) {
      console.error('Export error:', e);
      setExportError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700/80 rounded-2xl p-6 shadow-2xl max-w-md w-full space-y-5 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full bg-indigo-500" />
            <h3 className="text-sm font-semibold text-zinc-100">出版与全格式分发中心</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-sm px-2 py-1 rounded-lg hover:bg-zinc-800"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div className="text-zinc-400">选择导出格式：</div>
          <div className="grid grid-cols-3 gap-2">
            {([
              { id: 'txt', label: '作家助手 TXT', desc: '起点/番茄规范排版' },
              { id: 'docx', label: '责编审稿 Docx', desc: '首行缩进与字号规范' },
              { id: 'epub', label: '读者 EPUB', desc: '电子书封装格式' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFormat(item.id)}
                className={`p-3 rounded-xl border text-left flex flex-col justify-between transition-all ${
                  format === item.id
                    ? 'bg-indigo-600/20 border-indigo-500 text-white'
                    : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <div className="font-semibold text-zinc-200 mb-1">{item.label}</div>
                <div className="text-[10px] text-zinc-500">{item.desc}</div>
              </button>
            ))}
          </div>

          <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800 space-y-1">
            <div className="flex justify-between text-zinc-400">
              <span>待打包书名</span>
              <span className="text-zinc-200 font-medium">《{bookTitle}》</span>
            </div>
            <div className="flex justify-between text-zinc-400">
              <span>包含章节数</span>
              <span className="text-zinc-200 font-medium">{chapters.length} 章</span>
            </div>
          </div>

          {exportError && (
            <div className="text-red-400 text-xs bg-red-950/30 border border-red-900/50 p-2 rounded-lg">
              {exportError}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-medium transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={downloading}
            className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all flex items-center gap-1.5"
          >
            {downloading ? (
              <>
                <span className="animate-spin text-sm">⟳</span>
                <span>正在打包编译...</span>
              </>
            ) : (
              <span>开始下载</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
