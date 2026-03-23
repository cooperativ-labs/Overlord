import type { FeedPost } from '@/lib/actions/feed';

export type DemoTicket = {
  id: string;
  title: string;
  objective: string;
  status: 'draft' | 'execute' | 'review';
  priority: 'high' | 'medium' | 'low';
  execution_target: 'agent' | 'human';
  agent_session_state: 'attached' | 'idle' | 'completed' | null;
  running_agent: string | null;
  recent_agent: string | null;
  is_read: boolean;
  project_name: string;
  project_color: string;
};

export type DemoCurrentChangeLine = {
  kind: 'context' | 'add' | 'del';
  oldNumber: number | null;
  newNumber: number | null;
  content: string;
};

export type DemoCurrentChangeFile = {
  id: string;
  ticketId: string;
  path: string;
  status: 'A' | 'M';
  summary: string;
  linesAdded: number;
  linesRemoved: number;
  diffHeader: string;
  rationaleLabel: string;
  rationaleWhy: string;
  rationaleImpact: string;
  lines: DemoCurrentChangeLine[];
};

export type DemoFeedPost = FeedPost;

export const DEMO_PROJECT = {
  name: 'MyProject',
  color: '#6366f1',
  description: 'A simple 2D video game built with React and Canvas'
};

export const DEMO_FEED_PROJECTS = [
  {
    id: 'demo-overlord',
    name: 'Overlord Core',
    color: '#6366f1'
  },
  {
    id: 'demo-product',
    name: 'Demo Experience',
    color: '#0f766e'
  },
  {
    id: 'demo-automation',
    name: 'Workflow Automation',
    color: '#ea580c'
  }
] satisfies Array<{ id: string; name: string; color: string }>;

export const DEMO_FEED_POSTS = [
  {
    id: 'feed-001',
    organization_id: 1,
    project_id: 'demo-overlord',
    ticket_id: 'demo-21a7b495',
    session_id: 'sess-feed-001',
    agent_type: 'claude-code',
    title: 'Added a fourth demo tab for the /feed experience',
    body: 'The demo shell now includes a dedicated feed preview alongside the board, settings, and CLI tabs.\n\n- Reused the same window chrome for visual consistency\n- Added a mock project filter so the feed can be scoped in-demo\n- Kept the content local so the preview loads instantly without auth',
    tags: ['demo', 'feed', 'tabs'],
    impact_level: 'notable',
    files_touched: [
      'app/demo/DemoContent.tsx',
      'app/demo/DemoFeedPage.tsx',
      'app/demo/mock-data.ts'
    ],
    tradeoffs: [
      {
        decision: 'Use local mock feed data instead of live queries',
        alternatives_considered: 'Wire the preview to the production feed route',
        rationale: 'The demo should stay deterministic, fast, and accessible without a login.'
      }
    ],
    human_actions: ['Verify the tab order after the UI refresh.'],
    tickets_created: [],
    source_event_ids: ['evt-demo-feed-001', 'evt-demo-feed-002'],
    source_window_start: '2026-03-21T08:00:00.000Z',
    source_window_end: '2026-03-21T08:20:00.000Z',
    created_at: '2026-03-21T08:18:00.000Z',
    updated_at: '2026-03-21T08:18:00.000Z',
    project_name: 'Overlord Core',
    project_color: '#6366f1',
    ticket_title: 'Create a 4th demo tab',
    ticket_objective: 'Illustrate the new /feed feature in the demo shell.',
    ticket_sequence: 142
  },
  {
    id: 'feed-002',
    organization_id: 1,
    project_id: 'demo-product',
    ticket_id: 'demo-21a7b496',
    session_id: 'sess-feed-002',
    agent_type: 'codex',
    title: 'Feed cards now show human actions and tradeoffs inline',
    body: 'We updated the mock cards to mirror the live feed layout more closely.\n\n1. Human follow-ups stay visible even when the card is collapsed\n2. Tradeoff notes explain why a change was made\n3. File chips make it obvious which surface area changed',
    tags: ['feed', 'ux', 'review'],
    impact_level: 'significant',
    files_touched: [
      'components/features/feed/FeedCard.tsx',
      'components/features/feed/FeedList.tsx'
    ],
    tradeoffs: [
      {
        decision: 'Keep the expanded details behind a click',
        alternatives_considered: 'Show the entire body by default',
        rationale: 'Collapsed cards keep the timeline scannable while still inviting inspection.'
      }
    ],
    human_actions: [
      'Check that the collapsed state still exposes the important review context.',
      'Confirm the action badge wraps cleanly on smaller screens.'
    ],
    tickets_created: [],
    source_event_ids: ['evt-demo-feed-003'],
    source_window_start: '2026-03-20T16:10:00.000Z',
    source_window_end: '2026-03-20T16:40:00.000Z',
    created_at: '2026-03-20T16:28:00.000Z',
    updated_at: '2026-03-20T16:28:00.000Z',
    project_name: 'Demo Experience',
    project_color: '#0f766e',
    ticket_title: 'Add live-looking feed cards',
    ticket_objective: 'Mirror the real feed layout with mock review content.',
    ticket_sequence: 138
  },
  {
    id: 'feed-003',
    organization_id: 1,
    project_id: 'demo-automation',
    ticket_id: 'demo-21a7b497',
    session_id: 'sess-feed-003',
    agent_type: 'opencode',
    title: 'Review-ready deliverables now generate a clearer activity summary',
    body: 'The feed now reads more like a product history than a raw event log.\n\n- Added clearer language for what changed\n- Tuned the sample content to feel like real reviewer notes\n- Included short file lists so each post has a concrete trail',
    tags: ['automation', 'summary', 'history'],
    impact_level: 'minor',
    files_touched: ['app/api/protocol/update/route.ts', 'app/api/protocol/deliver/route.ts'],
    tradeoffs: [],
    human_actions: [],
    tickets_created: [],
    source_event_ids: ['evt-demo-feed-004', 'evt-demo-feed-005', 'evt-demo-feed-006'],
    source_window_start: '2026-03-19T09:00:00.000Z',
    source_window_end: '2026-03-19T09:30:00.000Z',
    created_at: '2026-03-19T09:22:00.000Z',
    updated_at: '2026-03-19T09:22:00.000Z',
    project_name: 'Workflow Automation',
    project_color: '#ea580c',
    ticket_title: 'Make feed posts easier to scan',
    ticket_objective: 'Summarize deliverable context in a readable timeline.',
    ticket_sequence: 131
  },
  {
    id: 'feed-004',
    organization_id: 1,
    project_id: 'demo-overlord',
    ticket_id: 'demo-21a7b498',
    session_id: 'sess-feed-004',
    agent_type: 'claude-code',
    title: 'Kept the demo feed offline-first and self-contained',
    body: 'This post exists to show the filtering and timeline behavior without reaching out to production data.\n\nIt keeps the preview fast, deterministic, and safe to open during a live walkthrough.',
    tags: ['offline', 'demo', 'reliable'],
    impact_level: 'notable',
    files_touched: ['app/demo/DemoFeedPage.tsx'],
    tradeoffs: [
      {
        decision: 'Avoid live links in the demo feed cards',
        alternatives_considered: 'Use the production ticket route for every post',
        rationale: 'The demo is more useful when every interaction stays within the walkthrough.'
      }
    ],
    human_actions: [
      'Decide whether the final tab label should stay as Feed or become Activity Feed.'
    ],
    tickets_created: [],
    source_event_ids: ['evt-demo-feed-007'],
    source_window_start: '2026-03-18T13:20:00.000Z',
    source_window_end: '2026-03-18T13:35:00.000Z',
    created_at: '2026-03-18T13:27:00.000Z',
    updated_at: '2026-03-18T13:27:00.000Z',
    project_name: 'Overlord Core',
    project_color: '#6366f1',
    ticket_title: 'Keep the feed preview self-contained',
    ticket_objective: 'Ensure the demo does not depend on authentication or remote data.',
    ticket_sequence: 127
  }
] satisfies DemoFeedPost[];

export const DEMO_CURRENT_CHANGES_BRANCH = 'demo/review-ready';
export const DEMO_CURRENT_CHANGES_DIRECTORY = '~/Development/MyProject';

export const DEMO_TICKETS: DemoTicket[] = [
  // Draft column
  {
    id: 'demo-001a',
    title: 'Set up game state management with React context',
    objective:
      'Create a GameContext provider that manages player state (health, score, position), game phase (menu, playing, paused, game-over), and level data. Use useReducer for predictable state transitions. Include TypeScript types for the full game state shape.',
    status: 'draft',
    priority: 'medium',
    execution_target: 'agent',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },
  {
    id: 'demo-002b',
    title: 'Design pixel art sprites for player character',
    objective:
      'Create a 32x32 sprite sheet for the player character with idle, walk (4 frames), jump, and attack animations. Export as PNG with transparent background. Follow the existing color palette defined in the design doc.',
    status: 'draft',
    priority: 'medium',
    execution_target: 'human',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },

  {
    id: 'demo-007g',
    title: 'Implement enemy AI pathfinding with A* algorithm',
    objective:
      'Build a pathfinding module using A* that enemies can use to navigate the tile map toward the player. Support configurable heuristics and path smoothing. Enemies should recalculate paths when the player moves more than 3 tiles from the last target.',
    status: 'draft',
    priority: 'medium',
    execution_target: 'agent',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },
  {
    id: 'demo-008h',
    title: 'Add save/load game progress with localStorage',
    objective:
      'Create a SaveManager that serializes game state (player position, score, current level, inventory) to localStorage. Support multiple save slots, auto-save on level completion, and a load screen that previews each save with timestamp and level name.',
    status: 'draft',
    priority: 'low',
    execution_target: 'agent',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },

  // These start as draft and move to execute when the user clicks Run
  {
    id: 'demo-003c',
    title: 'Implement player movement and collision detection',
    objective:
      'Add keyboard-driven player movement (WASD + arrow keys) with smooth acceleration and deceleration. Implement AABB collision detection against the tile map. Handle slope tiles and one-way platforms. Write unit tests for the collision math.',
    status: 'draft',
    priority: 'high',
    execution_target: 'agent',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },
  {
    id: 'demo-004d',
    title: 'Build level editor with drag-and-drop tiles',
    objective:
      'Create a browser-based level editor component. Users should be able to paint tiles onto a grid, select from a tile palette, save/load level JSON, and preview the level in-game. Use the existing TileSet component for the palette.',
    status: 'draft',
    priority: 'medium',
    execution_target: 'agent',
    agent_session_state: null,
    running_agent: null,
    recent_agent: null,
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },

  // Review column
  {
    id: 'demo-005e',
    title: 'Create main menu UI with start and settings buttons',
    objective:
      'Build the main menu screen with animated title text, a "Start Game" button, a "Settings" button, and a "Quit" button. Add keyboard navigation support. Include a starfield background animation using canvas.',
    status: 'review',
    priority: 'medium',
    execution_target: 'agent',
    agent_session_state: 'completed',
    running_agent: null,
    recent_agent: 'claude-code',
    is_read: false, // Unread!
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  },
  {
    id: 'demo-006f',
    title: 'Add sound effects and background music system',
    objective:
      'Implement an AudioManager class that handles loading, playing, and mixing sound effects and music tracks. Support volume control, fade in/out, and looping. Use Web Audio API for low-latency playback. Add sound effects for jump, collect, and hit events.',
    status: 'review',
    priority: 'medium',
    execution_target: 'agent',
    agent_session_state: 'completed',
    running_agent: null,
    recent_agent: 'claude-code',
    is_read: true,
    project_name: DEMO_PROJECT.name,
    project_color: DEMO_PROJECT.color
  }
];

export const DEMO_CURRENT_CHANGES_FILES: DemoCurrentChangeFile[] = [
  {
    id: 'change-main-menu',
    ticketId: 'demo-005e',
    path: 'src/ui/MainMenu.tsx',
    status: 'M',
    summary: 'Adds keyboard navigation state, highlighted menu actions, and a reusable CTA button.',
    linesAdded: 44,
    linesRemoved: 6,
    diffHeader: '@@ -14,12 +14,50 @@ export function MainMenu() {',
    rationaleLabel: 'Wire focus-aware menu actions into the start screen.',
    rationaleWhy:
      'The menu needs to work for keyboard-first players and for controller-style navigation.',
    rationaleImpact:
      'Players can move between actions with arrow keys and trigger Start or Settings without a pointer.',
    lines: [
      {
        kind: 'context',
        oldNumber: 14,
        newNumber: 14,
        content: "const MENU_ITEMS = ['Start Game', 'Settings', 'Quit'];"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 15,
        content: 'const [activeIndex, setActiveIndex] = useState(0);'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 16,
        content: "const [statusText, setStatusText] = useState('Press enter to begin');"
      },
      {
        kind: 'context',
        oldNumber: 15,
        newNumber: 17,
        content: ''
      },
      {
        kind: 'del',
        oldNumber: 22,
        newNumber: null,
        content: "return <button className='menu-button'>{label}</button>;"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 27,
        content: 'window.addEventListener(keyboardEvent, handleMenuNavigation);'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 28,
        content: 'setStatusText(`Selected ${MENU_ITEMS[nextIndex]}`);'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 29,
        content: 'return <MenuButton active={active} onClick={onSelect}>{label}</MenuButton>;'
      }
    ]
  },
  {
    id: 'change-starfield',
    ticketId: 'demo-005e',
    path: 'src/ui/StarfieldBackground.tsx',
    status: 'A',
    summary:
      'Introduces a canvas starfield with drift, twinkle, and resize handling for the menu backdrop.',
    linesAdded: 68,
    linesRemoved: 0,
    diffHeader: '@@ -0,0 +1,68 @@',
    rationaleLabel: 'Create a lightweight animated backdrop for the menu scene.',
    rationaleWhy:
      'The main menu needed motion and depth without distracting from the title and actions.',
    rationaleImpact:
      'The landing screen feels alive immediately and still performs well on modest hardware.',
    lines: [
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 1,
        content: 'export function StarfieldBackground({ density = 90 }: { density?: number }) {'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 7,
        content: 'const stars = createStars(canvas.width, canvas.height, density);'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 18,
        content: "ctx.fillStyle = 'rgba(6, 10, 24, 0.55)';"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 26,
        content: 'star.x = star.x <= 0 ? canvas.width : star.x - star.speed;'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 39,
        content: 'window.addEventListener(resizeEvent, resizeCanvas);'
      }
    ]
  },
  {
    id: 'change-audio-manager',
    ticketId: 'demo-006f',
    path: 'src/audio/AudioManager.ts',
    status: 'A',
    summary:
      'Adds a central audio manager for loading, fading, and mixing music and sound effects.',
    linesAdded: 91,
    linesRemoved: 0,
    diffHeader: '@@ -0,0 +1,91 @@',
    rationaleLabel: 'Centralize music and effects playback behind a single manager.',
    rationaleWhy:
      'The game needed one place to coordinate loading, looping, and volume changes across scenes.',
    rationaleImpact:
      'Menu music, jump effects, and future combat sounds can share a predictable API.',
    lines: [
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 1,
        content: 'export class AudioManager {'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 9,
        content: 'private musicBus = this.context.createGain();'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 28,
        content: 'async loadTrack(key: string, url: string) {'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 52,
        content: 'fadeTo(channel.gain, targetVolume, 0.35);'
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 77,
        content: 'playEffect(name: SoundEffectName, options?: PlaybackOptions) {'
      }
    ]
  },
  {
    id: 'change-sound-effects',
    ticketId: 'demo-006f',
    path: 'src/game/systems/sound-effects.ts',
    status: 'M',
    summary:
      'Hooks jump, collect, and hit events into the new audio manager with per-event defaults.',
    linesAdded: 22,
    linesRemoved: 5,
    diffHeader: '@@ -3,10 +3,27 @@ export function registerSoundEffects(game: Game) {',
    rationaleLabel: 'Map gameplay events onto named sound cues.',
    rationaleWhy:
      'Adding event-level helpers keeps sound triggers out of gameplay logic and reduces duplication.',
    rationaleImpact:
      'Gameplay systems can emit semantic events while the sound system chooses volumes and variations.',
    lines: [
      {
        kind: 'context',
        oldNumber: 3,
        newNumber: 3,
        content: 'export function registerSoundEffects(game: Game) {'
      },
      {
        kind: 'del',
        oldNumber: 7,
        newNumber: null,
        content: "game.events.on('jump', () => play('jump.wav'));"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 7,
        content: "game.events.on('jump', () => audio.playEffect('jump', { volume: 0.7 }));"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 8,
        content: "game.events.on('collect', () => audio.playEffect('collect', { volume: 0.55 }));"
      },
      {
        kind: 'add',
        oldNumber: null,
        newNumber: 9,
        content: "game.events.on('hit', () => audio.playEffect('hit', { volume: 0.8 }));"
      }
    ]
  }
];

export const DEMO_ACTIVITY = [
  {
    id: '1',
    type: 'update',
    summary: 'Attached to ticket and loaded project context.',
    phase: 'execute',
    timestamp: '2 min ago',
    agent: 'claude-code'
  },
  {
    id: '2',
    type: 'update',
    summary:
      'Analyzed existing codebase structure. Found `src/components/` and `src/game/` directories.',
    phase: 'execute',
    timestamp: '1 min ago',
    agent: 'claude-code'
  },
  {
    id: '3',
    type: 'update',
    summary:
      'Implemented `MainMenu.tsx` with animated title, button components, and keyboard nav. Added starfield canvas background.',
    phase: 'execute',
    timestamp: '45s ago',
    agent: 'claude-code'
  },
  {
    id: '4',
    type: 'deliver',
    summary:
      'Delivered main menu implementation. Created 3 new files, modified 2 existing. All tests passing.',
    phase: 'deliver',
    timestamp: '30s ago',
    agent: 'claude-code'
  }
];

export type TerminalLine = {
  text: string;
  type: 'system' | 'agent' | 'info' | 'success' | 'command';
  delay: number; // ms before this line appears
};

export const DISCUSS_TERMINAL_LINES: TerminalLine[] = [
  { text: '$ ovld discuss --ticket-id demo-003c', type: 'command', delay: 0 },
  { text: '', type: 'system', delay: 400 },
  { text: 'Starting your agent...', type: 'system', delay: 600 },
  { text: 'Reading ticket context and project guidance.', type: 'agent', delay: 1200 },
  {
    text: 'Loading objectives, acceptance criteria, and shared state.',
    type: 'agent',
    delay: 1800
  },
  { text: '', type: 'system', delay: 2200 },
  {
    text: "Ok, I understand this ticket. It's about implementing player movement with WASD/arrow keys and AABB collision detection against the tile map.",
    type: 'agent',
    delay: 2600
  },
  { text: '', type: 'system', delay: 3200 },
  { text: 'What would you like to discuss?', type: 'info', delay: 3400 }
];

export const RUN_TERMINAL_LINES: TerminalLine[] = [
  { text: '$ ovld run claude --ticket-id demo-003c', type: 'command', delay: 0 },
  { text: '', type: 'system', delay: 400 },
  { text: 'Starting your agent...', type: 'system', delay: 600 },
  { text: 'Attaching to ticket ID: demo-003c', type: 'agent', delay: 1200 },
  { text: '[session: a1b2c3d4] Session attached successfully.', type: 'success', delay: 1800 },
  { text: '', type: 'system', delay: 2200 },
  { text: 'Reading project context and ticket objectives...', type: 'agent', delay: 2400 },
  {
    text: 'Analyzing src/game/Player.ts and src/game/CollisionSystem.ts',
    type: 'agent',
    delay: 3200
  },
  {
    text: 'Implementing keyboard input handler with acceleration curves.',
    type: 'agent',
    delay: 4000
  },
  {
    text: 'Writing AABB collision detection with tile map integration.',
    type: 'agent',
    delay: 4800
  },
  { text: 'Adding slope tile and one-way platform support.', type: 'agent', delay: 5400 },
  { text: 'Writing unit tests for collision math utilities.', type: 'agent', delay: 6000 },
  { text: '', type: 'system', delay: 6600 },
  { text: 'Delivering a summary of my work back to your ticket...', type: 'success', delay: 7000 },
  {
    text: '[deliver] 5 files changed, 342 lines added, all tests passing.',
    type: 'success',
    delay: 7600
  }
];

export const OVLD_COMMANDS_TERMINAL_LINES: TerminalLine[] = [
  { text: '$ ovld --help', type: 'command', delay: 0 },
  { text: '', type: 'system', delay: 300 },
  { text: 'ovld - Overlord CLI for ticket-driven agent work', type: 'system', delay: 500 },
  { text: '', type: 'system', delay: 600 },
  { text: 'COMMANDS:', type: 'info', delay: 800 },
  { text: '  run <agent>     Launch an agent to execute a ticket', type: 'system', delay: 1000 },
  { text: '  discuss <agent> Start a discussion about a ticket', type: 'system', delay: 1100 },
  { text: '  protocol        Low-level protocol commands', type: 'system', delay: 1200 },
  { text: '  restart         Resume a previous agent session', type: 'system', delay: 1300 },
  { text: '', type: 'system', delay: 1500 },
  { text: 'PROTOCOL SUBCOMMANDS:', type: 'info', delay: 1700 },
  { text: '  attach          Attach to a ticket and start a session', type: 'system', delay: 1800 },
  { text: '  update          Post a progress update', type: 'system', delay: 1900 },
  { text: '  ask             Ask a blocking question', type: 'system', delay: 2000 },
  { text: '  deliver         Deliver work and move to review', type: 'system', delay: 2100 },
  { text: '', type: 'system', delay: 2300 },
  { text: 'Run ovld <command> --help for more details.', type: 'info', delay: 2500 }
];
