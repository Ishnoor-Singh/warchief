import type { Flowchart } from '../types';

interface Props {
  flowchart: Flowchart | undefined;
  lieutenantName: string | undefined;
  activeNodes?: Record<string, string | null>;
  selectedLieutenant?: string | null;
}

export function FlowchartPanel({ flowchart, lieutenantName, activeNodes, selectedLieutenant }: Props) {
  // Determine which node ids are currently active for this lieutenant's troops
  const activeNodeIds = new Set<string>();
  if (activeNodes && flowchart) {
    // The flowchart is per-lieutenant, but activeNodes is per-agent
    // Collect all active node ids from any agent
    for (const nodeId of Object.values(activeNodes)) {
      if (nodeId) activeNodeIds.add(nodeId);
    }
  }

  return (
    <div className="flowchart-panel">
      <h3>
        {lieutenantName ? `${lieutenantName}'s Flowchart` : 'Flowchart'}
      </h3>

      {!flowchart || flowchart.nodes.length === 0 ? (
        <div className="flowchart-empty">
          {lieutenantName
            ? 'No active flowchart. Send an order to generate one.'
            : 'Select a lieutenant to view their flowchart.'}
        </div>
      ) : (
        <div className="flowchart-nodes">
          {flowchart.nodes
            .sort((a, b) => (b.priority || 0) - (a.priority || 0))
            .map(node => {
              const isActive = activeNodeIds.has(node.id);
              return (
                <div
                  key={node.id}
                  className={`flowchart-node ${isActive ? 'active' : ''}`}
                >
                  <div className="flowchart-node-header">
                    <span className="event">on {node.on}</span>
                    {node.priority !== undefined && node.priority > 0 && (
                      <span className="priority">p:{node.priority}</span>
                    )}
                    {isActive && <span className="active-indicator">ACTIVE</span>}
                  </div>
                  {node.condition && (
                    <div className="condition">if {node.condition}</div>
                  )}
                  <div className="action-row">
                    <span className="arrow">-&gt; </span>
                    <span className="action">{node.action.type}</span>
                    {node.action.type === 'moveTo' && node.action.position && (
                      <span className="action-params">
                        ({(node.action.position as {x: number; y: number}).x}, {(node.action.position as {x: number; y: number}).y})
                      </span>
                    )}
                    {node.action.type === 'setFormation' && node.action.formation && (
                      <span className="action-params">{String(node.action.formation)}</span>
                    )}
                  </div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
