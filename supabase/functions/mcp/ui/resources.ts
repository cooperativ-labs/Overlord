import {
  TICKET_CARD_DESCRIPTION,
  TICKET_CARD_HTML,
  TICKET_CARD_META,
  TICKET_CARD_MIME_TYPE,
  TICKET_CARD_RESOURCE_URI,
  TICKET_CARD_TITLE
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
    name: TICKET_CARD_TITLE,
    description: TICKET_CARD_DESCRIPTION,
    mimeType: TICKET_CARD_MIME_TYPE,
    text: TICKET_CARD_HTML,
    _meta: TICKET_CARD_META
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
