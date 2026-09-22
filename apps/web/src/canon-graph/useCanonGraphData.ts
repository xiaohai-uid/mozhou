import { useEffect, useState } from 'react';
import { post } from '../lib/post';

export interface GraphNode {
  id: string;
  name: string;
  type: 'character' | 'faction' | 'item' | 'location';
  faction?: string;
  role?: string;
  realm?: string;
  contractsCount?: number;
  x: number;
  y: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relation: string;
  contract?: {
    summary: string;
    status: 'ACTIVE' | 'FULFILLED' | 'BREACHED';
    deadline?: string | undefined;
    penalty?: string | undefined;
  };
}

const DEFAULT_NODES: GraphNode[] = [
  { id: 'c1', name: '林守常', type: 'character', faction: '三清观', role: '主角 / 假神转世', realm: '炼气初期', contractsCount: 2, x: 250, y: 200 },
  { id: 'c2', name: '陈九安', type: 'character', faction: '龙国治安局', role: '特事处执事', realm: '化劲宗师', contractsCount: 1, x: 500, y: 150 },
  { id: 'c3', name: '张老伯', type: 'character', faction: '城南庙祝', role: '关键证人', realm: '凡人', contractsCount: 1, x: 180, y: 380 },
  { id: 'c4', name: '白骨真人', type: 'character', faction: '九幽阴煞教', role: '前期反派', realm: '筑基中期', contractsCount: 1, x: 550, y: 380 },
  { id: 'f1', name: '龙国治安局特事处', type: 'faction', role: '官方机构', x: 580, y: 80 },
  { id: 'f2', name: '三清观遗址', type: 'faction', role: '隐世道统', x: 150, y: 120 },
  { id: 'i1', name: '残破古令', type: 'item', role: '核心道具', x: 360, y: 290 },
];

const DEFAULT_LINKS: GraphLink[] = [
  {
    source: 'c1',
    target: 'c2',
    relation: '互相试探',
    contract: { summary: '城南纸扎铺案情报共享', status: 'ACTIVE' },
  },
  {
    source: 'c1',
    target: 'c3',
    relation: '庇护与供奉',
    contract: { summary: '保张家三代平安', status: 'ACTIVE' },
  },
  {
    source: 'c1',
    target: 'c4',
    relation: '生死仇敌',
    contract: { summary: '百日之内必斩其于剑下', status: 'ACTIVE' },
  },
  { source: 'c2', target: 'f1', relation: '所属势力' },
  { source: 'c1', target: 'f2', relation: '传承源流' },
  { source: 'c1', target: 'i1', relation: '持有法器' },
];

export function useCanonGraphData(bookRoot?: string | null) {
  const [nodes, setNodes] = useState<GraphNode[]>(DEFAULT_NODES);
  const [links, setLinks] = useState<GraphLink[]>(DEFAULT_LINKS);
  const [isLive, setIsLive] = useState(false);
  const [isDemo, setIsDemo] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [tick, setTick] = useState(0);

  const reload = () => setTick((t) => t + 1);

  useEffect(() => {
    if (!bookRoot) {
      setNodes(DEFAULT_NODES);
      setLinks(DEFAULT_LINKS);
      setIsLive(false);
      setIsDemo(true);
      setIsEmpty(false);
      return;
    }
    let mounted = true;
    post<{
      ok: boolean;
      state?: {
        entityCards?: Array<{
          ref: string;
          cardType: string;
          name: string;
          brief: string | null;
        }>;
        trackingLines?: {
          promises?: Array<{ payload: string }>;
        };
      };
    }>('/api/book.state', { root: bookRoot })
      .then((res) => {
        if (!mounted || !res.ok || !res.state || !res.state.entityCards) return;
        const cards = res.state.entityCards;
        if (cards.length === 0) {
          setNodes([]);
          setLinks([]);
          setIsLive(true);
          setIsDemo(false);
          setIsEmpty(true);
          return;
        }

        const total = cards.length;
        const mappedNodes: GraphNode[] = cards.map((card, idx) => {
          const angle = (idx / total) * 2 * Math.PI;
          const radius = total <= 4 ? 140 : 200;
          return {
            id: card.ref,
            name: card.name,
            type:
              card.cardType === 'char'
                ? 'character'
                : card.cardType === 'fact'
                ? 'faction'
                : card.cardType === 'loc'
                ? 'location'
                : 'item',
            role: card.brief || card.name,
            contractsCount: 0,
            x: Math.round(380 + radius * Math.cos(angle)),
            y: Math.round(260 + radius * Math.sin(angle)),
          };
        });

        const mappedLinks: GraphLink[] = [];
        if (res.state.trackingLines?.promises) {
          for (const p of res.state.trackingLines.promises) {
            let parsedSource: string | null = null;
            let parsedTarget: string | null = null;
            let relation = '契约约定';
            let summary = p.payload;
            let deadline: string | undefined = undefined;
            let penalty: string | undefined = undefined;

            try {
              const parsed: unknown = JSON.parse(p.payload);
              if (parsed && typeof parsed === 'object') {
                const obj = parsed as Record<string, unknown>;
                const s = typeof obj.summary === 'string' ? obj.summary : '';
                summary = s || p.payload;
                const r = typeof obj.relation === 'string' ? obj.relation : '';
                relation = r || '契约约定';
                deadline = typeof obj.deadline === 'string' ? obj.deadline : undefined;
                penalty = typeof obj.penalty === 'string' ? obj.penalty : undefined;
                const source = typeof obj.source === 'string' ? obj.source : '';
                const target = typeof obj.target === 'string' ? obj.target : '';
                const sNode = mappedNodes.find((n) => n.name === source || n.id === source);
                const tNode = mappedNodes.find((n) => n.name === target || n.id === target);
                if (sNode && tNode && sNode.id !== tNode.id) {
                  parsedSource = sNode.id;
                  parsedTarget = tNode.id;
                }
              }
            } catch {
              // 文本匹配：查找 payload 中提及的两个实体
              const matched = mappedNodes.filter((n) => p.payload.includes(n.name));
              if (matched.length >= 2) {
                parsedSource = matched[0]!.id;
                parsedTarget = matched[1]!.id;
              }
            }

            if (parsedSource && parsedTarget) {
              mappedLinks.push({
                source: parsedSource,
                target: parsedTarget,
                relation,
                contract: {
                  summary,
                  status: 'ACTIVE',
                  deadline,
                  penalty,
                },
              });
            }
          }
        }

        setNodes(mappedNodes);
        setLinks(mappedLinks);
        setIsLive(true);
        setIsDemo(false);
        setIsEmpty(false);
      })
      .catch(() => {
        if (mounted) {
          setNodes([]);
          setLinks([]);
          setIsLive(false);
          setIsDemo(false);
          setIsEmpty(true);
        }
      });

    return () => {
      mounted = false;
    };
  }, [bookRoot, tick]);

  const addLink = (newLink: GraphLink) => {
    setLinks((prev) => [...prev, newLink]);
  };

  return { nodes, links, isLive, isDemo, isEmpty, addLink, reload };
}
