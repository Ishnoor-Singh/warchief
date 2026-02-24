import type { Flowchart } from '../types';

interface Props {
  flowchart: Flowchart | undefined;
  lieutenantName: string | undefined;
}

export function FlowchartPanel({ flowchart, lieutenantName }: Props) {
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
            .map(node => (
              <div key={node.id} className="flowchart-node">
                <span className="event">on {node.on}</span>
                {node.condition && (
                  <span className="condition"> [{node.condition}]</span>
                )}
                <span> → </span>
                <span className="action">{node.action.type}</span>
                {node.priority && (
                  <span className="priority"> (p:{node.priority})</span>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
