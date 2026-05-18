import { ClipboardList, Eye, GitBranch, Workflow } from 'lucide-react';

export const problemPages = [
  {
    slug: 'remember-agent-intent',
    icon: ClipboardList,
    problem: 'What did I ask this agent to do 20 minutes ago?',
    shortTitle: 'Remember agent intent',
    cta: 'See how The Feed keeps you on point',
    headline: 'Keep the original ask attached to the work.',
    video: 'https://youtu.be/BFc41HEkmZY?si=ZfpfWhav_5qVjbdd',
    summary:
      'Overlord lets you group prompts into Objectives, creating a durable record of context, acceptance criteria, target repo, updates, and delivery history. The work record remains readable after the terminal session, chat, or agent run is gone.',
    features: [
      {
        title: 'Prompts become durable objectives',
        description:
          'Capture the ask, constraints, working directory, project, and acceptance criteria before execution starts.'
      },
      {
        title: 'Every update stays with the ticket',
        description:
          'Progress notes, blocking questions, artifacts, and delivery summaries build a timeline you can review later.'
      },
      {
        title: 'Follow-up work stays sequential',
        description:
          'Add another objective to the same ticket instead of opening a new chat that has none of the original context.'
      }
    ],
    agentNote:
      'Agents should attach to the ticket, read the objective, post meaningful progress, and deliver with a summary tied back to the original ask.'
  },
  {
    slug: 'review-agent-diffs',
    icon: Eye,
    problem: 'What changes the agent made are actually important?',
    shortTitle: 'Review agent diffs',
    cta: 'See ticket activity',
    headline: 'Review what agents changed *and why*.',
    video: null,
    summary:
      'Overlord keeps the objective, delivery notes, artifacts, and file-change rationales next to the work so reviewers can evaluate whether the result matches the ask, not just whether the diff looks plausible.',
    features: [
      {
        title: 'Delivery summaries explain the outcome',
        description:
          'Agents close work with a concise account of what changed, what was verified, and what remains.'
      },
      {
        title: 'File-change rationales make diffs reviewable',
        description:
          'Meaningful behavioral changes can be described with the reason, impact, and relevant hunks.'
      },
      {
        title: 'Artifacts stay attached',
        description:
          'Test results, URLs, notes, screenshots, and context references live with the ticket instead of a separate chat.'
      }
    ],
    agentNote:
      'Agents should explain behavioral changes in review language: what changed, why it changed, impact, and verification.'
  },
  {
    slug: 'handoff-between-agents',
    icon: GitBranch,
    problem: 'Claude planned, now I want Codex to implement. How do I keep the context?',
    shortTitle: 'Handoff between agents',
    cta: 'Select an agent for each objective',
    headline: 'Move work between agents without starting over.',
    video: null,
    summary:
      'Overlord is deliberately agent-neutral. Codex, Claude Code, Cursor, Gemini, OpenCode, MCP tools, terminal workflows, and desktop agents can all report into the same ticket record.',
    features: [
      {
        title: 'One ticket, many execution surfaces',
        description:
          'Launch or resume work from the web app, desktop app, CLI, MCP, or an installed agent plugin.'
      },
      {
        title: 'Shared context travels with the objective',
        description:
          'Agents can read prior activity, uploaded artifacts, stored context, and previous deliveries before continuing.'
      },
      {
        title: 'Use the right agent for each phase',
        description:
          'Plan with one agent, implement with another, and review or follow up with a third while preserving continuity.'
      }
    ],
    agentNote:
      'Agents should treat Overlord as the handoff source of truth before resuming work from another tool or session.'
  },
  // {
  //   slug: 'manage-agent-workstreams',
  //   icon: Workflow,
  //   problem: 'I have too many agent threads running to know what needs attention.',
  //   shortTitle: 'Manage agent workstreams',
  //   cta: 'See workstream control',
  //   headline: 'See which agent work needs attention.',
  //   summary:
  //     'Overlord gives agent work a lifecycle: next up, execute, review, blocked, delivered, and follow-up. That makes concurrent and sequential agent work visible instead of scattered across terminal tabs and chats.',
  //   features: [
  //     {
  //       title: 'Board state reflects agent work',
  //       description:
  //         'Tickets move through planning, execution, review, and delivery so you can scan what is active.'
  //     },
  //     {
  //       title: 'Blocking questions become explicit',
  //       description:
  //         'Agents can ask for human input through the ticket instead of burying important decisions in a stream.'
  //     },
  //     {
  //       title: 'Review and follow-up are first-class',
  //       description:
  //         'Delivered work can be accepted, continued, or sent back through another objective without losing the record.'
  //     }
  //   ],
  //   agentNote:
  //     'Agents should publish progress at meaningful checkpoints and ask clear blocking questions when human input is required.'
  // },
  {
    slug: 'juggling-repos',
    icon: Workflow,
    problem: 'OMG I launched the agent in the wrong repo again!',
    shortTitle: 'Juggling repos',
    cta: 'See repo juggling',
    headline: 'Launch the agent in the right repo automatically.',
    video: null,
    summary:
      'Overlord opens the terminal in the right repo before starting the agent. You can even open the terminal in the right repo before launching the agent.',
    features: [
      {
        title: 'Open the terminal in the right repo before launching the agent',
        description:
          'Overlord opens the terminal in the right repo before starting the agent. You can even open the terminal in the right repo before launching the agent.'
      }
    ],
    agentNote: 'Agents should open the terminal in the right repo before launching the agent.'
  }
] as const;

export type ProblemPage = (typeof problemPages)[number];

export function getProblemPage(slug: string): ProblemPage | undefined {
  return problemPages.find(page => page.slug === slug);
}
