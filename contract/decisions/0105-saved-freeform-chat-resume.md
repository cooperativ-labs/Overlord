# ADR 0105: Resume saved freeform chats through the original paired Latch host

- Date: 2026-11-23
- Status: accepted
- Amends: 0104

## Context

Freeform Compose chat belongs to a signed-in Mobile account and a paired
Latch host. Closing a terminal ends its process and a new terminal has a new
Latch ID. Some native agents retain the conversation and can restore it by
their own ID.

## Decision

Mobile retains the saved chat, authenticated host key, verified native ID,
harness and original working directory, independently of the current
terminal. Latch records the device-scoped launch environment and native
identity in its private state outside terminal retention.

Resume is a separate Latch v2 operation. The original device with control
grant supplies the saved chat ID and a durable operation ID. Latch selects
the exact native ID, confirms the original terminal ended, and starts a
qualified adapter in the original directory after checking its history.
An accepted retry reuses its outcome. A launch whose outcome remains
uncertain blocks another launch. Mobile waits for the resumed native
identity and prior messages through the Conversation Hub before allowing
the same chat to reopen.

New connectors declare resume status and evidence. A support claim requires
a verified version and a close-and-resume fixture covering exact identity,
restored Hub messages and follow-up. Existing objective launch and
Overlord authorization paths continue independently.

## Consequences

Contract impact: minor. The additive descriptor and gateway endpoint keep
older Mobile ledgers, Latch gateways and connector manifests compatible.
Native IDs are correlation data. Pairing and account state still govern
access. The saved-chat identity contains no transcript text or credentials.

## Alternatives considered

Adding a field to normal create would allow an older gateway that ignores
unknown fields to start a blank chat. Sending a path and native ID from
Mobile would let the caller pick another local conversation, so the host
holds the authoritative binding.
