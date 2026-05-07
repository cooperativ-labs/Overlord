/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { moduleResolution: 'node' } }]
  },
  moduleNameMapper: {
    '^@/app/(.*)$': '<rootDir>/apps/web/app/$1',
    '^@/components/(.*)$': '<rootDir>/apps/web/components/$1',
    '^@/lib/(.*)$': '<rootDir>/lib/$1',
    '^@/supabase/(.*)$': '<rootDir>/supabase/$1',
    '^@/types/(.*)$': '<rootDir>/types/$1',
    '^@/agent-models$': '<rootDir>/agent-models.json',
    '^@/agent-models\\.json$': '<rootDir>/agent-models.json'
  },
  testMatch: ['<rootDir>/tests/**/*.test.ts']
};
