import {
  TICKET_CARD_HTML,
  TICKET_CARD_MIME_TYPE,
  TICKET_CARD_RESOURCE_URI
} from './ticket-card-resource.ts';

type UiResource = {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  text: string;
  _meta: Record<string, unknown>;
};

const UI_RESOURCES: UiResource[] = [
  {
    uri: TICKET_CARD_RESOURCE_URI,
    name: 'Overlord Ticket Card',
    description: 'Inline MCP app for reviewing and saving a drafted Overlord ticket.',
    mimeType: TICKET_CARD_MIME_TYPE,
    text: TICKET_CARD_HTML,
    _meta: {
      ui: {
        csp: {
          connectDomains: [],
          resourceDomains: []
        },
        permissions: {}
      },
      'openai/widgetDescription':
        'Review and edit a drafted Overlord ticket before saving it from chat.',
      'openai/widgetPrefersBorder': true,
      'openai/widgetCSP': {
        connect_domains: [],
        resource_domains: []
      }
    }
  }
];

export function listUiResources() {
  return UI_RESOURCES.map(({ uri, name, description, mimeType, _meta }) => ({
    uri,
    name,
    description,
    mimeType,
    _meta
  }));
}

export function getUiResourceByUri(uri: string) {
  return UI_RESOURCES.find(resource => resource.uri === uri) ?? null;
}
