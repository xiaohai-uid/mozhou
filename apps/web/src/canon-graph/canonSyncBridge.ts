import { GraphNode, GraphLink } from './useCanonGraphData';

export function syncContractToLocalCanon(
  contract: {
    sourceId: string;
    targetId: string;
    relation: string;
    summary: string;
    deadline?: string;
    penalty?: string;
  },
  existingLinks: GraphLink[]
): GraphLink[] {
  const newLink: GraphLink = {
    source: contract.sourceId,
    target: contract.targetId,
    relation: contract.relation,
    contract: {
      summary: contract.summary,
      status: 'ACTIVE',
    },
  };

  return [...existingLinks, newLink];
}
