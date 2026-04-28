Create a draft Overlord ticket.

Use the text after `/create` as the objective unless raw flags are present.

Run:
`ovld protocol create --agent cursor --objective "<objective>"`

If raw flags are present, pass them through after:
`ovld protocol create --agent cursor`

If `ovld` reports `OVERLORD_URL` is unreachable, stop and request permission escalation or network access before retrying.
