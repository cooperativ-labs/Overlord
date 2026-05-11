import {
  organizationIdFromTicketId,
  parseTicketIdParts,
  ticketSequenceFromTicketId
} from '@/lib/overlord/human-ticket-id';

describe('human-ticket-id', () => {
  it('parses org and sequence', () => {
    expect(parseTicketIdParts('1:991')).toEqual({ organizationId: 1, ticketSequence: 991 });
  });

  it('rejects UUIDs and malformed ids', () => {
    expect(parseTicketIdParts('feb3a556-113a-4730-94dd-34773022bdbb')).toBeNull();
    expect(parseTicketIdParts('1:2:3')).toBeNull();
    expect(parseTicketIdParts('')).toBeNull();
  });

  it('exposes organizationIdFromTicketId and ticketSequenceFromTicketId', () => {
    expect(organizationIdFromTicketId('42:7')).toBe(42);
    expect(ticketSequenceFromTicketId('42:7')).toBe(7);
    expect(ticketSequenceFromTicketId('not-a-ticket')).toBeNull();
  });
});
