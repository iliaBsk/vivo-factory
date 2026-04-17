import { definePluginEntry, jsonResult, readStringParam } from 'openclaw/plugin-sdk/core';

const DEFAULT_BASE_URL = 'http://127.0.0.1:5400';

export default definePluginEntry({
  id: 'user-profile',
  name: 'User Profile',
  description: 'Marble-powered user profile sidecar: injects user interests into prompts and provides tools to record reactions and update profile facts.',

  register(api) {
    const baseUrl = (api.pluginConfig?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');

    // Inject profile summary into every agent prompt as system context
    api.on('before_prompt_build', async () => {
      try {
        const res = await fetch(`${baseUrl}/user-profile/graph/summary`);
        if (!res.ok) return {};
        const { interests = [], context } = await res.json();

        const top = interests
          .slice(0, 10)
          .map(i => `${i.topic}(${Number(i.weight ?? 0).toFixed(2)})`)
          .join(', ');

        const lines = ['## User Profile (marble)'];
        if (top) lines.push(`Interests: ${top}`);
        if (context && typeof context === 'object') {
          for (const [k, v] of Object.entries(context)) {
            if (v != null && v !== '') lines.push(`${k}: ${v}`);
          }
        }

        return { appendSystemContext: lines.join('\n') + '\n' };
      } catch {
        return {};
      }
    });

    // Tool: fetch full profile summary
    api.registerTool({
      name: 'marble_get_profile',
      description: 'Fetch the current user profile from marble: top interests, beliefs, context, and last insight.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: async (_id, _params) => {
        const res = await fetch(`${baseUrl}/user-profile/graph/summary`);
        if (!res.ok) throw new Error(`marble ${res.status}`);
        return jsonResult(await res.json());
      }
    });

    // Tool: record content reaction
    api.registerTool({
      name: 'marble_react',
      description: 'Record user reaction to a content item, updating the user knowledge graph. Call this whenever the user approves, rejects, skips, or shares content.',
      parameters: {
        type: 'object',
        required: ['item_id', 'reaction'],
        additionalProperties: false,
        properties: {
          item_id: { type: 'string', description: 'Unique content item identifier' },
          title: { type: 'string', description: 'Content item title' },
          topics: { type: 'array', items: { type: 'string' }, description: 'Topics/tags for the item' },
          source: { type: 'string', description: 'Content source (e.g. hackernews, techcrunch)' },
          reaction: {
            type: 'string',
            enum: ['up', 'down', 'skip', 'share'],
            description: 'up=approve, down=reject, skip=neutral, share=strong approve'
          }
        }
      },
      execute: async (_id, params) => {
        const res = await fetch(`${baseUrl}/user-profile/profile/decisions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            item: {
              id: readStringParam(params, 'item_id', { required: true }),
              title: readStringParam(params, 'title'),
              topics: Array.isArray(params.topics) ? params.topics : [],
              source: readStringParam(params, 'source')
            },
            reaction: readStringParam(params, 'reaction', { required: true })
          })
        });
        if (!res.ok) throw new Error(`marble ${res.status}: ${await res.text()}`);
        return jsonResult(await res.json());
      }
    });

    // Tool: update user facts
    api.registerTool({
      name: 'marble_update_facts',
      description: 'Update user profile facts in marble: boost interests, set context, record beliefs, preferences, or identity roles.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          interests: {
            type: 'array',
            items: { type: 'string' },
            description: 'Topics to boost interest in'
          },
          context: {
            type: 'object',
            additionalProperties: true,
            description: 'Current user context: calendar events, active projects, location, mood'
          },
          beliefs: {
            type: 'array',
            description: 'Beliefs to record',
            items: {
              type: 'object',
              required: ['topic', 'claim'],
              additionalProperties: false,
              properties: {
                topic: { type: 'string' },
                claim: { type: 'string' },
                strength: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          },
          preferences: {
            type: 'array',
            description: 'Preferences to record',
            items: {
              type: 'object',
              required: ['type', 'description'],
              additionalProperties: false,
              properties: {
                type: { type: 'string' },
                description: { type: 'string' },
                strength: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          },
          identities: {
            type: 'array',
            description: 'User identity roles to record',
            items: {
              type: 'object',
              required: ['role'],
              additionalProperties: false,
              properties: {
                role: { type: 'string' },
                context: { type: 'string' },
                salience: { type: 'number', minimum: 0, maximum: 1 }
              }
            }
          }
        }
      },
      execute: async (_id, params) => {
        const body = {};
        if (Array.isArray(params.interests)) body.interests = params.interests;
        if (params.context && typeof params.context === 'object') body.context = params.context;
        if (Array.isArray(params.beliefs)) body.beliefs = params.beliefs;
        if (Array.isArray(params.preferences)) body.preferences = params.preferences;
        if (Array.isArray(params.identities)) body.identities = params.identities;

        const res = await fetch(`${baseUrl}/user-profile/profile/facts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error(`marble ${res.status}: ${await res.text()}`);
        return jsonResult(await res.json());
      }
    });

      const vivoFactoryUrl = (api.pluginConfig?.vivoFactoryUrl ?? "").replace(/\/$/, "");
      const audienceId = process.env.AUDIENCE_ID ?? "";

      api.registerTool({
        name: "audience_add_source",
        description:
          "Add a news source, RSS feed, or website to this audience's daily recap pipeline. " +
          "Use this when the user mentions a publication, website, or topic they want to follow regularly.",
        parameters: {
          type: "object",
          required: ["url", "category"],
          properties: {
            url: {
              type: "string",
              description: "RSS feed URL or main website URL of the source"
            },
            category: {
              type: "string",
              description: "Content category: news, entertainment, deals, travel, tech, sports, lifestyle"
            },
            type: {
              type: "string",
              enum: ["rss", "merchant"],
              description: "Source type — use rss for feeds and websites (default: rss)"
            },
            weight: {
              type: "number",
              description: "Relevance weight from 0.1 (low) to 1.0 (high). Default: 0.7"
            }
          }
        },
        execute: async (_id, params) => {
          if (!vivoFactoryUrl || !audienceId) {
            return jsonResult({
              ok: false,
              errors: ["audience_add_source: vivoFactoryUrl or AUDIENCE_ID not configured"],
              warnings: [],
              data: null
            });
          }
          const response = await fetch(
            `${vivoFactoryUrl}/api/audiences/${audienceId}/sources`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                source: {
                  type: params.type ?? "rss",
                  url: params.url,
                  category: params.category,
                  weight: params.weight ?? 0.7,
                  location: "custom"
                }
              })
            }
          );
          let data;
          try {
            data = await response.json();
          } catch {
            return jsonResult({
              ok: false,
              data: null,
              errors: ["Failed to parse response from pipeline"],
              warnings: []
            });
          }
          return jsonResult({
            ok: response.ok,
            data: response.ok ? { source_id: data.source_id } : null,
            errors: response.ok ? [] : ["Failed to add source to pipeline"],
            warnings: []
          });
        }
      });
  }
});
