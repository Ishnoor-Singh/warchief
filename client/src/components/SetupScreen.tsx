import { useState } from 'react';

interface Model {
  id: string;
  name: string;
  default?: boolean;
}

interface Props {
  models: Model[];
  selectedModel: string;
  onSetApiKey: (apiKey: string) => void;
  onSetModel: (model: string) => void;
  isValidating: boolean;
  error: string | null;
}

export function SetupScreen({ models, selectedModel, onSetApiKey, onSetModel, isValidating, error }: Props) {
  const [apiKey, setApiKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onSetApiKey(apiKey.trim());
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <h1>⚔️ WARCHIEF</h1>
        <p className="setup-subtitle">
          Command your army through natural language. Your lieutenants will interpret your orders using AI.
        </p>

        <form onSubmit={handleSubmit} className="setup-form">
          <div className="form-group">
            <label htmlFor="apiKey">Anthropic API Key</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="api-key-input"
              disabled={isValidating}
            />
            <p className="form-hint">
              Your API key is used client-side only and never stored.{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                Get a key →
              </a>
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={selectedModel}
              onChange={e => onSetModel(e.target.value)}
              className="model-select"
              disabled={isValidating}
            >
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <p className="form-hint">
              Sonnet 4 is recommended. Haiku is faster but may produce simpler tactics.
            </p>
          </div>

          {error && (
            <div className="setup-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="setup-button"
            disabled={!apiKey.trim() || isValidating}
          >
            {isValidating ? 'Validating...' : 'Enter Battle →'}
          </button>
        </form>

        <div className="setup-privacy">
          <h3>🔒 Privacy</h3>
          <ul>
            <li>Your API key is stored in memory only</li>
            <li>Keys are sent directly to Anthropic, never to our server</li>
            <li>Refresh the page to clear your key</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
