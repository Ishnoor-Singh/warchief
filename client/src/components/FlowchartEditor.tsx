import { useState } from 'react';
import type { Flowchart, FlowchartNode } from '../types';

const EVENT_TYPES = [
  'enemy_spotted',
  'under_attack',
  'flanked',
  'ally_down',
  'casualty_threshold',
  'order_received',
  'no_enemies_visible',
  'arrived',
  'message',
  'tick',
];

const ACTION_TYPES = [
  'engage',
  'hold',
  'moveTo',
  'fallback',
  'setFormation',
  'requestSupport',
  'emit',
];

const FORMATION_TYPES = ['line', 'wedge', 'scatter', 'pincer', 'defensive_circle', 'column'];

const EVENT_DESCRIPTIONS: Record<string, string> = {
  enemy_spotted: 'Triggered when a troop spots an enemy. Data: distance, position',
  under_attack: 'Triggered when taking damage. Data: attackerId, damage',
  flanked: 'Triggered when attacked from side/rear. Data: direction (left/right/rear)',
  ally_down: 'Triggered when a friendly unit dies nearby. Data: unitId, position',
  casualty_threshold: 'Triggered at squad loss milestones. Data: lossPercent (0-100)',
  order_received: 'Triggered when receiving a message order. Data: order, from',
  no_enemies_visible: 'Triggered when no enemies are in sight',
  arrived: 'Triggered when reaching a moveTo destination',
  message: 'Triggered on receiving any message. Data: from, content',
  tick: 'Triggered every simulation tick (use sparingly)',
};

const ACTION_DESCRIPTIONS: Record<string, string> = {
  engage: 'Attack the nearest enemy or a specific target',
  hold: 'Stay in place, stop moving',
  moveTo: 'Move to a map position (x, y)',
  fallback: 'Retreat to a safe position (x, y)',
  setFormation: 'Change troop formation type',
  requestSupport: 'Send a support request message upward',
  emit: 'Broadcast a report or alert message',
};

const ACTION_COLORS: Record<string, string> = {
  engage: '#ff6b6b',
  hold: '#6b6bff',
  moveTo: '#4a9eff',
  fallback: '#ffaa4a',
  setFormation: '#6bff6b',
  requestSupport: '#ff9fff',
  emit: '#ffff6b',
};

const EVENT_COLORS: Record<string, string> = {
  enemy_spotted: '#ff6b6b',
  under_attack: '#ff4444',
  flanked: '#ffaa4a',
  ally_down: '#ff8844',
  casualty_threshold: '#ffaa4a',
  order_received: '#4a9eff',
  no_enemies_visible: '#6bff6b',
  arrived: '#6bffaa',
  message: '#6b9eff',
  tick: '#888',
};

type NodeAction = { type: string; [key: string]: unknown };

function buildDefaultAction(actionType: string): NodeAction {
  switch (actionType) {
    case 'moveTo': return { type: 'moveTo', position: { x: 200, y: 150 } };
    case 'fallback': return { type: 'fallback', position: { x: 50, y: 150 } };
    case 'setFormation': return { type: 'setFormation', formation: 'line' };
    case 'engage': return { type: 'engage', targetId: '' };
    case 'requestSupport': return { type: 'requestSupport', message: '' };
    case 'emit': return { type: 'emit', eventType: 'report', message: '' };
    case 'hold': return { type: 'hold' };
    default: return { type: actionType };
  }
}

function makeNodeId(base: string, existing: FlowchartNode[]): string {
  const clean = base.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  let id = clean;
  let n = 1;
  while (existing.find(nd => nd.id === id)) {
    id = `${clean}_${n++}`;
  }
  return id;
}

function ActionParamsEditor({
  action,
  onChange,
}: {
  action: NodeAction;
  onChange: (a: NodeAction) => void;
}) {
  switch (action.type) {
    case 'moveTo':
    case 'fallback': {
      const pos = (action.position as { x: number; y: number }) ?? { x: 200, y: 150 };
      return (
        <div className="action-params-editor">
          <span className="ape-label">Position</span>
          <label className="ape-inline">
            X:
            <input
              type="number"
              className="ape-input small"
              value={pos.x}
              min={0}
              max={500}
              onChange={e => onChange({ ...action, position: { x: Number(e.target.value), y: pos.y } })}
            />
          </label>
          <label className="ape-inline">
            Y:
            <input
              type="number"
              className="ape-input small"
              value={pos.y}
              min={0}
              max={500}
              onChange={e => onChange({ ...action, position: { x: pos.x, y: Number(e.target.value) } })}
            />
          </label>
          <span className="ape-hint">Map is 400×300; W=west/left, E=east/right</span>
        </div>
      );
    }
    case 'setFormation': {
      return (
        <div className="action-params-editor">
          <span className="ape-label">Formation</span>
          <select
            className="ape-select"
            value={String(action.formation ?? 'line')}
            onChange={e => onChange({ ...action, formation: e.target.value })}
          >
            {FORMATION_TYPES.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      );
    }
    case 'requestSupport': {
      return (
        <div className="action-params-editor">
          <span className="ape-label">Message</span>
          <input
            type="text"
            className="ape-input wide"
            placeholder="e.g. Flank exposed, need support"
            value={String(action.message ?? '')}
            onChange={e => onChange({ ...action, message: e.target.value })}
          />
        </div>
      );
    }
    case 'emit': {
      return (
        <div className="action-params-editor">
          <span className="ape-label">Type</span>
          <select
            className="ape-select"
            value={String(action.eventType ?? 'report')}
            onChange={e => onChange({ ...action, eventType: e.target.value })}
          >
            <option value="report">report</option>
            <option value="alert">alert</option>
          </select>
          <span className="ape-label" style={{ marginLeft: 8 }}>Message</span>
          <input
            type="text"
            className="ape-input wide"
            placeholder="Message text..."
            value={String(action.message ?? '')}
            onChange={e => onChange({ ...action, message: e.target.value })}
          />
        </div>
      );
    }
    case 'engage':
      return (
        <div className="action-params-editor">
          <span className="ape-hint">Automatically targets nearest enemy in range</span>
        </div>
      );
    case 'hold':
      return (
        <div className="action-params-editor">
          <span className="ape-hint">No parameters — troops stand their ground</span>
        </div>
      );
    default:
      return null;
  }
}

function NodeRow({
  node,
  onUpdate,
  onDelete,
  mapWidth,
  mapHeight: _mapHeight,
}: {
  node: FlowchartNode;
  onUpdate: (updated: FlowchartNode) => void;
  onDelete: () => void;
  mapWidth: number;
  mapHeight: number;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<FlowchartNode>({ ...node, action: { ...node.action } });

  function startEdit() {
    setDraft({ ...node, action: { ...node.action } });
    setEditing(true);
  }

  function saveEdit() {
    onUpdate(draft);
    setEditing(false);
  }

  function cancelEdit() {
    setDraft({ ...node, action: { ...node.action } });
    setEditing(false);
  }

  const eventColor = EVENT_COLORS[node.on] ?? '#aaa';
  const actionColor = ACTION_COLORS[node.action.type] ?? '#aaa';

  if (editing) {
    return (
      <div className="fc-node-row fc-node-editing">
        <div className="fc-node-edit-grid">
          {/* Event trigger */}
          <div className="fc-edit-field">
            <label className="fc-edit-label">Trigger event</label>
            <select
              className="fc-edit-select"
              value={draft.on}
              onChange={e => setDraft(d => ({ ...d, on: e.target.value }))}
            >
              {EVENT_TYPES.map(ev => <option key={ev} value={ev}>{ev}</option>)}
            </select>
            <div className="fc-edit-hint">{EVENT_DESCRIPTIONS[draft.on] ?? ''}</div>
          </div>

          {/* Condition */}
          <div className="fc-edit-field">
            <label className="fc-edit-label">Condition <span className="fc-edit-optional">(optional)</span></label>
            <input
              type="text"
              className="fc-edit-input"
              placeholder='e.g. distance < 50 or lossPercent > 30'
              value={draft.condition ?? ''}
              onChange={e => setDraft(d => ({ ...d, condition: e.target.value || undefined }))}
            />
            <div className="fc-edit-hint">Simple expression using event data. Leave blank to always trigger.</div>
          </div>

          {/* Action */}
          <div className="fc-edit-field">
            <label className="fc-edit-label">Action</label>
            <select
              className="fc-edit-select"
              value={draft.action.type}
              onChange={e => setDraft(d => ({ ...d, action: buildDefaultAction(e.target.value) }))}
            >
              {ACTION_TYPES.map(at => <option key={at} value={at}>{at}</option>)}
            </select>
            <div className="fc-edit-hint">{ACTION_DESCRIPTIONS[draft.action.type] ?? ''}</div>
          </div>

          {/* Action params */}
          <div className="fc-edit-field">
            <label className="fc-edit-label">Action parameters</label>
            <ActionParamsEditor
              action={draft.action}
              onChange={a => setDraft(d => ({ ...d, action: a }))}
            />
          </div>

          {/* Priority */}
          <div className="fc-edit-field">
            <label className="fc-edit-label">Priority</label>
            <input
              type="number"
              className="fc-edit-input narrow"
              value={draft.priority ?? 0}
              min={0}
              max={20}
              onChange={e => setDraft(d => ({ ...d, priority: Number(e.target.value) }))}
            />
            <div className="fc-edit-hint">Higher priority nodes are checked first. 0–20.</div>
          </div>
        </div>

        <div className="fc-node-edit-actions">
          <button className="fc-btn fc-btn-save" onClick={saveEdit}>Save</button>
          <button className="fc-btn fc-btn-cancel" onClick={cancelEdit}>Cancel</button>
        </div>
      </div>
    );
  }

  // Read-only display
  return (
    <div className="fc-node-row">
      <div className="fc-node-summary">
        <span className="fc-node-event" style={{ color: eventColor }}>on {node.on}</span>
        {node.condition && (
          <span className="fc-node-cond">if {node.condition}</span>
        )}
        <span className="fc-node-arrow">→</span>
        <span className="fc-node-action" style={{ color: actionColor }}>{node.action.type}</span>
        {node.action.type === 'moveTo' || node.action.type === 'fallback' ? (
          <span className="fc-node-params">
            ({Math.round((node.action.position as { x: number; y: number })?.x ?? 0)},
            {Math.round((node.action.position as { x: number; y: number })?.y ?? 0)})
            <span className="fc-node-compass">
              {' '}— {
                (() => {
                  const x = (node.action.position as { x: number; y: number })?.x ?? 0;
                  if (x < mapWidth * 0.25) return 'far west';
                  if (x < mapWidth * 0.45) return 'west';
                  if (x < mapWidth * 0.55) return 'center';
                  if (x < mapWidth * 0.75) return 'east';
                  return 'far east';
                })()
              }
            </span>
          </span>
        ) : node.action.type === 'setFormation' ? (
          <span className="fc-node-params">[{String(node.action.formation)}]</span>
        ) : node.action.type === 'requestSupport' || node.action.type === 'emit' ? (
          <span className="fc-node-params">"{String(node.action.message ?? '')}"</span>
        ) : null}
        {node.priority !== undefined && node.priority > 0 && (
          <span className="fc-node-priority">p:{node.priority}</span>
        )}
      </div>
      <div className="fc-node-controls">
        <button className="fc-btn fc-btn-edit" onClick={startEdit} title="Edit this node">Edit</button>
        <button className="fc-btn fc-btn-del" onClick={onDelete} title="Delete this node">✕</button>
      </div>
    </div>
  );
}

interface Props {
  flowchart: Flowchart | undefined;
  lieutenantName: string | undefined;
  mapWidth: number;
  mapHeight: number;
  onUpdateNode: (operation: 'add' | 'update' | 'delete', node?: FlowchartNode, nodeId?: string) => void;
}

export function FlowchartEditor({ flowchart, lieutenantName, mapWidth, mapHeight, onUpdateNode }: Props) {
  const [addingNode, setAddingNode] = useState(false);
  const [newNodeDraft, setNewNodeDraft] = useState<FlowchartNode>({
    id: '',
    on: 'enemy_spotted',
    action: { type: 'engage', targetId: '' },
    priority: 5,
  });

  const nodes = flowchart?.nodes ?? [];

  function handleUpdate(updated: FlowchartNode) {
    onUpdateNode('update', updated);
  }

  function handleDelete(nodeId: string) {
    onUpdateNode('delete', undefined, nodeId);
  }

  function startAddNode() {
    const defaultId = makeNodeId('custom_node', nodes);
    setNewNodeDraft({
      id: defaultId,
      on: 'enemy_spotted',
      action: { type: 'engage', targetId: '' },
      priority: 5,
    });
    setAddingNode(true);
  }

  function confirmAddNode() {
    if (!newNodeDraft.id.trim()) return;
    const safeId = makeNodeId(newNodeDraft.id.trim(), nodes);
    onUpdateNode('add', { ...newNodeDraft, id: safeId });
    setAddingNode(false);
  }

  return (
    <div className="fc-editor">
      <div className="fc-editor-header">
        <span className="fc-editor-title">
          {lieutenantName ? `${lieutenantName}'s Flowchart` : 'Flowchart'}
        </span>
        <span className="fc-editor-subtitle">
          Rules applied to all troops under this lieutenant
        </span>
      </div>

      {nodes.length === 0 && !addingNode && (
        <div className="fc-empty">
          No flowchart yet. Brief this lieutenant to auto-generate one, or add rules manually below.
        </div>
      )}

      <div className="fc-nodes-list">
        {[...nodes]
          .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
          .map(node => (
            <NodeRow
              key={node.id}
              node={node}
              onUpdate={handleUpdate}
              onDelete={() => handleDelete(node.id)}
              mapWidth={mapWidth}
              mapHeight={mapHeight}
            />
          ))}
      </div>

      {addingNode ? (
        <div className="fc-node-row fc-node-editing fc-node-new">
          <div className="fc-node-new-label">New rule</div>
          <div className="fc-node-edit-grid">
            <div className="fc-edit-field">
              <label className="fc-edit-label">Rule ID</label>
              <input
                type="text"
                className="fc-edit-input narrow"
                value={newNodeDraft.id}
                placeholder="unique_id"
                onChange={e => setNewNodeDraft(d => ({ ...d, id: e.target.value }))}
              />
            </div>

            <div className="fc-edit-field">
              <label className="fc-edit-label">Trigger event</label>
              <select
                className="fc-edit-select"
                value={newNodeDraft.on}
                onChange={e => setNewNodeDraft(d => ({ ...d, on: e.target.value }))}
              >
                {EVENT_TYPES.map(ev => <option key={ev} value={ev}>{ev}</option>)}
              </select>
              <div className="fc-edit-hint">{EVENT_DESCRIPTIONS[newNodeDraft.on] ?? ''}</div>
            </div>

            <div className="fc-edit-field">
              <label className="fc-edit-label">Condition <span className="fc-edit-optional">(optional)</span></label>
              <input
                type="text"
                className="fc-edit-input"
                placeholder='e.g. distance < 50'
                value={newNodeDraft.condition ?? ''}
                onChange={e => setNewNodeDraft(d => ({ ...d, condition: e.target.value || undefined }))}
              />
            </div>

            <div className="fc-edit-field">
              <label className="fc-edit-label">Action</label>
              <select
                className="fc-edit-select"
                value={newNodeDraft.action.type}
                onChange={e => setNewNodeDraft(d => ({ ...d, action: buildDefaultAction(e.target.value) }))}
              >
                {ACTION_TYPES.map(at => <option key={at} value={at}>{at}</option>)}
              </select>
              <div className="fc-edit-hint">{ACTION_DESCRIPTIONS[newNodeDraft.action.type] ?? ''}</div>
            </div>

            <div className="fc-edit-field">
              <label className="fc-edit-label">Action parameters</label>
              <ActionParamsEditor
                action={newNodeDraft.action}
                onChange={a => setNewNodeDraft(d => ({ ...d, action: a }))}
              />
            </div>

            <div className="fc-edit-field">
              <label className="fc-edit-label">Priority</label>
              <input
                type="number"
                className="fc-edit-input narrow"
                value={newNodeDraft.priority ?? 5}
                min={0}
                max={20}
                onChange={e => setNewNodeDraft(d => ({ ...d, priority: Number(e.target.value) }))}
              />
            </div>
          </div>

          <div className="fc-node-edit-actions">
            <button
              className="fc-btn fc-btn-save"
              onClick={confirmAddNode}
              disabled={!newNodeDraft.id.trim()}
            >
              Add Rule
            </button>
            <button className="fc-btn fc-btn-cancel" onClick={() => setAddingNode(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="fc-add-btn" onClick={startAddNode}>
          + Add Rule
        </button>
      )}

      {nodes.length > 0 && (
        <div className="fc-editor-footer">
          <span className="fc-default-label">Default (no match):</span>
          <span className="fc-default-action">hold position</span>
        </div>
      )}
    </div>
  );
}
